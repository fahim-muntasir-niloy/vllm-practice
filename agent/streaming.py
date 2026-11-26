"""Turn a deep agent run into a flat list of events a UI can render.

Every event is a JSON-ready dict with a "type". Events that belong to an agent
also carry "path": the ids of the `task` tool calls leading to the subagent that
produced them. An empty path means the main agent.

    text       {"path", "message_id", "delta"}
    tool_call  {"path", "message_id", "id", "name", "args_delta"}  while the model writes the call
    tool_call  {"path", "message_id", "id", "name", "args"}        once the arguments are complete
    progress   {"path", "id", "data"}                custom update from a running tool
    tool_result{"path", "id", "result", "is_error"}
    usage      {"path", "input_tokens", "output_tokens"}
    context    {"path", "used", "max", "categories", "buffer", "free", "tools"}
               what fills the main agent's context window (see agent/context.py)
"""

from collections.abc import AsyncIterator

from langchain_core.messages import AIMessageChunk, BaseMessage, ToolMessage

from agent.context import RequestRecorder, measure_context

# Caps the agent loop so a confused model can't call tools forever.
RECURSION_LIMIT = 25


async def agent_events(
    agent,
    messages: list[BaseMessage],
    own_prompt: str = "",
    own_tools: frozenset[str] = frozenset(),
    thread_id: str | None = None,
) -> AsyncIterator[dict]:
    """Stream a run. Pass the agent's own prompt and tool names to get context events.

    With a `thread_id` and a checkpointer, `messages` only needs the new message.
    """
    request = RequestRecorder()
    config = {"recursion_limit": RECURSION_LIMIT, "callbacks": [request]}
    if thread_id:
        config["configurable"] = {"thread_id": thread_id}
    # Task id -> id of the tool call that task runs.
    task_calls: dict[str, str] = {}
    # (namespace, message id, index) -> tool call id. Later chunks only carry the index.
    chunk_calls: dict[tuple, str] = {}

    async for part in agent.astream(
        {"messages": messages},
        config,
        stream_mode=["messages", "updates", "custom", "tasks"],
        subgraphs=True,
        version="v2",
    ):
        kind, namespace, data = part["type"], part["ns"], part["data"]

        if kind == "tasks":
            # Task starts list the tool calls they run. This links subagent
            # namespaces ("tools:<task id>") back to the `task` call.
            if data.get("name") == "tools" and isinstance(data.get("input"), list):
                for call in data["input"]:
                    task_calls[data["id"]] = call["id"]
            continue

        path = [
            task_calls.get(segment.split(":", 1)[1], segment)
            for segment in namespace
            if segment.startswith("tools:")
        ]

        if kind == "custom":
            if isinstance(data, dict) and data.get("task") in task_calls:
                yield {
                    "type": "progress",
                    "path": path,
                    "id": task_calls[data["task"]],
                    "data": data["data"],
                }

        elif kind == "messages":
            message, metadata = data
            if isinstance(message, ToolMessage):
                yield {
                    "type": "tool_result",
                    "path": path,
                    "id": message.tool_call_id,
                    "result": message.text,
                    "is_error": message.status == "error",
                }
            # Only the agent's own replies, not model calls made by middleware.
            elif (
                isinstance(message, AIMessageChunk)
                and metadata.get("langgraph_node") == "model"
                and metadata.get("lc_source") != "summarization"
            ):
                if message.text:
                    yield {"type": "text", "path": path, "message_id": message.id, "delta": message.text}
                for chunk in message.tool_call_chunks:
                    key = (namespace, message.id, chunk["index"])
                    if chunk["id"]:
                        chunk_calls[key] = chunk["id"]
                    if key in chunk_calls:
                        yield {
                            "type": "tool_call",
                            "path": path,
                            "message_id": message.id,
                            "id": chunk_calls[key],
                            "name": chunk["name"] or "",
                            "args_delta": chunk["args"] or "",
                        }

        elif kind == "updates":
            update = data.get("model")
            if not update:
                continue
            for message in update.get("messages", []):
                if message.type != "ai":
                    continue
                # The finished message has the parsed arguments; chunks may be partial.
                for call in message.tool_calls:
                    yield {
                        "type": "tool_call",
                        "path": path,
                        "message_id": message.id,
                        "id": call["id"],
                        "name": call["name"],
                        "args": call["args"],
                    }
                for call in message.invalid_tool_calls:
                    yield {
                        "type": "tool_result",
                        "path": path,
                        "id": call["id"],
                        "result": f"Invalid tool call: {call['error']}",
                        "is_error": True,
                    }
                if usage := message.usage_metadata:
                    yield {
                        "type": "usage",
                        "path": path,
                        "input_tokens": usage["input_tokens"],
                        "output_tokens": usage["output_tokens"],
                    }
                    if own_prompt and not path:
                        used = usage["input_tokens"] + usage["output_tokens"]
                        if context := await measure_context(request, used, own_prompt, own_tools):
                            yield {"type": "context", "path": path, **context}
