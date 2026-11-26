"""Measure what fills the model's context window, using vLLM's tokenizer."""

import json

import httpx
from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.messages import BaseMessage, SystemMessage, ToolMessage

from agent.llm import CONTEXT_TOKENS, VLLM_BASE_URL, VLLM_MODEL
from utils.logger import logger

# vLLM serves /tokenize at the server root, not under /v1.
TOKENIZE_URL = VLLM_BASE_URL.rstrip("/").removesuffix("/v1") + "/tokenize"
# deepagents compacts the conversation once it passes this share of the window.
COMPACT_AT = 0.85


class RequestRecorder(AsyncCallbackHandler):
    """Keeps the main agent's latest model request, exactly as it was sent."""

    def __init__(self) -> None:
        self.messages: list[BaseMessage] = []
        self.tools: list[dict] = []

    async def on_chat_model_start(self, serialized, messages, *, metadata=None, **kwargs) -> None:
        tools = (kwargs.get("invocation_params") or {}).get("tools")
        # Subagents have a nested namespace; calls without tools are internal (summaries).
        if not tools or "|" in (metadata or {}).get("langgraph_checkpoint_ns", ""):
            return
        self.messages = messages[0]
        self.tools = tools


async def _count(client: httpx.AsyncClient, **body) -> int:
    response = await client.post(TOKENIZE_URL, json={"model": VLLM_MODEL, **body})
    response.raise_for_status()
    return response.json()["count"]


async def measure_context(
    request: RequestRecorder, used: int, own_prompt: str, own_tools: set[str]
) -> dict | None:
    """Break `used` tokens (the last request plus its reply) down by source.

    Returns None if the tokenizer can't be reached, so the chat carries on without it.
    """
    system = next((m.text for m in request.messages if isinstance(m, SystemMessage)), "")
    probe = [{"role": "system", "content": system}, {"role": "user", "content": "."}]
    try:
        async with httpx.AsyncClient(timeout=10) as client:

            async def count_text(text: str) -> int:
                return await _count(client, prompt=text, add_special_tokens=False)

            without_system = await _count(client, messages=probe[1:])
            with_system = await _count(client, messages=probe)
            with_tools = await _count(client, messages=probe, tools=request.tools)
            own_tokens = await count_text(own_prompt)
            sizes = {
                t["function"]["name"]: await count_text(json.dumps(t["function"]))
                for t in request.tools
            }
            results = 0
            for message in request.messages:
                if isinstance(message, ToolMessage):
                    results += await count_text(message.text)
    except (httpx.HTTPError, KeyError) as error:
        logger.warning(f"Could not measure the context: {error}")
        return None

    system_tokens = max(with_system - without_system, 0)
    own_tokens = min(own_tokens, system_tokens)
    tool_tokens = max(with_tools - with_system, 0)
    # Scale each tool's share so the list adds up to what the tools really cost.
    scale = tool_tokens / (sum(sizes.values()) or 1)
    tools = [
        {"name": name, "tokens": round(size * scale), "custom": name in own_tools}
        for name, size in sizes.items()
    ]
    custom_tokens = sum(t["tokens"] for t in tools if t["custom"])
    results = min(results, max(used - system_tokens - tool_tokens, 0))
    buffer = round(CONTEXT_TOKENS * (1 - COMPACT_AT))

    categories = {
        "messages": max(used - system_tokens - tool_tokens - results, 0),
        "tool_results": results,
        "system_prompt": own_tokens,
        "agent_instructions": system_tokens - own_tokens,
        "builtin_tools": max(tool_tokens - custom_tokens, 0),
        "custom_tools": custom_tokens,
    }
    return {
        "used": used,
        "max": CONTEXT_TOKENS,
        "categories": categories,
        "buffer": buffer,
        "free": max(CONTEXT_TOKENS - used - buffer, 0),
        "tools": sorted(tools, key=lambda t: -t["tokens"]),
    }
