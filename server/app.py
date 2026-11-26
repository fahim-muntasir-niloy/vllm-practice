"""FastAPI server: serves the React chat UI and streams the deep agent's run to it."""

import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# `uv run server/app.py` only puts server/ on the path; the agent lives in the project root.
sys.path.insert(0, str(ROOT))

# Imported first: it configures checkpoint loading before langgraph is imported.
from agent.memory import open_checkpointer, rewind

from fastapi import FastAPI, HTTPException
from fastapi import Path as PathParam
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from agent import history
from agent.factory import CUSTOM_TOOLS, SYSTEM_PROMPT, build_agent
from agent.llm import VLLM_MODEL
from agent.streaming import agent_events
from utils.logger import logger

FRONTEND_DIST = ROOT / "frontend" / "dist"
THREAD_ID = r"^[A-Za-z0-9_-]{1,64}$"


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with open_checkpointer() as checkpointer:
        await history.setup(checkpointer)
        app.state.checkpointer = checkpointer
        app.state.agent = build_agent(checkpointer)
        yield


app = FastAPI(title="vLLM chat", lifespan=lifespan)


class ChatRequest(BaseModel):
    """One new user message. The server remembers the rest of the thread."""

    thread_id: str = Field(pattern=THREAD_ID)
    message_id: str = Field(min_length=1, max_length=64)
    content: str = Field(min_length=1)
    # Ids of the earlier user messages the chat still shows, oldest first.
    history: list[str] = []


@app.post("/api/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    """Stream the run as newline-delimited JSON, one event per line (see agent/streaming.py)."""
    agent = app.state.agent
    message = HumanMessage(content=req.content, id=req.message_id)

    async def event_stream():
        try:
            await rewind(agent, {"configurable": {"thread_id": req.thread_id}}, req.history)
            own_tools = frozenset(t.name for t in CUSTOM_TOOLS)
            async for event in agent_events(
                agent, [message], SYSTEM_PROMPT, own_tools, thread_id=req.thread_id
            ):
                if event["type"] == "context":
                    await history.save_context(app.state.checkpointer, req.thread_id, event)
                yield json.dumps(event, ensure_ascii=False, default=str) + "\n"
        except Exception as error:
            # The response has already started, so report the failure as an event.
            logger.exception("Agent run failed")
            yield json.dumps({"type": "error", "message": f"{type(error).__name__}: {error}"}) + "\n"

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        # Stop proxies from holding back the stream.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/threads")
async def threads() -> list[dict]:
    return await history.list_threads(app.state.agent, app.state.checkpointer)


@app.get("/api/threads/{thread_id}")
async def thread(thread_id: str = PathParam(pattern=THREAD_ID)) -> dict:
    saved = await history.load_thread(app.state.agent, app.state.checkpointer, thread_id)
    if saved is None:
        raise HTTPException(404, "Thread not found")
    return saved


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
