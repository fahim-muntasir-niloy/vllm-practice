"""Per-thread conversation memory, kept in a SQLite file."""

import os
from contextlib import asynccontextmanager
from pathlib import Path

# Only load known-safe types from the database. Must be set before langgraph is imported.
os.environ.setdefault("LANGGRAPH_STRICT_MSGPACK", "true")

from langchain_core.messages import RemoveMessage  # noqa: E402
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver  # noqa: E402

# Outside the agent's workspace, so the agent can't read or change it.
DATABASE = Path(__file__).resolve().parent.parent / ".data" / "checkpoints.sqlite"


@asynccontextmanager
async def open_checkpointer(path: Path = DATABASE):
    path.parent.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(path)) as checkpointer:
        yield checkpointer


async def rewind(agent, config: dict, history: list[str]) -> None:
    """Forget turns that the chat no longer shows.

    `history` holds the ids of the earlier user messages still on screen. The first
    stored user message that isn't among them was regenerated or edited, so it and
    everything after it is removed.
    """
    state = await agent.aget_state(config)
    messages = state.values.get("messages", [])
    keep = set(history)
    for index, message in enumerate(messages):
        # Summaries are written by the agent itself when it compacts a long thread.
        summary = message.additional_kwargs.get("lc_source") == "summarization"
        if message.type == "human" and not summary and message.id not in keep:
            stale = [RemoveMessage(id=m.id) for m in messages[index:]]
            await agent.aupdate_state(config, {"messages": stale}, as_node="model")
            return
