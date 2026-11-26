"""FastAPI server: serves the React chat UI and a streaming chat endpoint backed by vLLM."""

import os
import sys

from langchain_openai import ChatOpenAI

# On Linux, vLLM is bound to the Docker bridge address (see documentation/instructions.md).
# On Windows, vLLM runs in WSL2 and is reached through localhost.
DEFAULT_VLLM_HOST = "127.0.0.1" if sys.platform == "win32" else "172.17.0.1"
VLLM_BASE_URL = os.environ.get("VLLM_BASE_URL", f"http://{DEFAULT_VLLM_HOST}:8000/v1")
VLLM_MODEL = os.environ.get("VLLM_MODEL", "LiquidAI/LFM2.5-1.2B-Instruct")
# Must match `vllm serve --max-model-len`.
CONTEXT_TOKENS = int(os.environ.get("VLLM_CONTEXT_TOKENS", "32768"))

llm = ChatOpenAI(
    base_url=VLLM_BASE_URL,
    api_key="none",
    model=VLLM_MODEL,
    temperature=0.1,  # low, so the small model picks tools more reliably
    streaming=True,
    stream_usage=True,  # report token counts on streamed replies
    # Tells deepagents the window size, so it compacts long conversations before they overflow.
    profile={"max_input_tokens": CONTEXT_TOKENS},
)
