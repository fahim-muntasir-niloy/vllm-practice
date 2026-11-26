"""FastAPI server: serves the React chat UI and a streaming chat endpoint backed by vLLM."""

import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

# vLLM is bound to the Docker bridge address (see documentation/instructions.md).
VLLM_BASE_URL = os.environ.get("VLLM_BASE_URL", "http://172.17.0.1:8000/v1")
VLLM_MODEL = os.environ.get("VLLM_MODEL", "LiquidAI/LFM2.5-1.2B-Instruct")

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

app = FastAPI(title="vLLM chat")

llm = ChatOpenAI(
    base_url=VLLM_BASE_URL,
    api_key="none",
    model=VLLM_MODEL,
    temperature=0.7,
    streaming=True,
)


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


def to_langchain(messages: list[ChatMessage]) -> list[BaseMessage]:
    converted: list[BaseMessage] = []
    for m in messages:
        if m.role == "system":
            converted.append(SystemMessage(content=m.content))
        elif m.role == "assistant":
            converted.append(AIMessage(content=m.content))
        else:
            converted.append(HumanMessage(content=m.content))
    return converted


@app.post("/api/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    messages = to_langchain(req.messages)

    async def token_stream():
        async for chunk in llm.astream(messages):
            if chunk.content:
                yield chunk.content

    return StreamingResponse(token_stream(), media_type="text/plain; charset=utf-8")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "model": VLLM_MODEL}


# Serve the built React app at "/". Build it first with `npm run build` in frontend/.
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")


if __name__ == "__main__":
    # Lets you run `uv run server/app.py` directly.
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8001")))
