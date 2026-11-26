"""Read saved threads back out of memory, for the thread list."""

import json

from langchain_core.messages import BaseMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

TITLE_CHARS = 60


def _config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}}


def _is_user_message(message: BaseMessage) -> bool:
    # Summaries are written by the agent itself when it compacts a long thread.
    return message.type == "human" and message.additional_kwargs.get("lc_source") != "summarization"


async def setup(saver: AsyncSqliteSaver) -> None:
    await saver.setup()
    async with saver.lock:
        # The context panel's latest numbers, which checkpoints don't hold.
        await saver.conn.execute(
            "CREATE TABLE IF NOT EXISTS thread_context (thread_id TEXT PRIMARY KEY, context TEXT NOT NULL)"
        )
        await saver.conn.commit()


async def save_context(saver: AsyncSqliteSaver, thread_id: str, context: dict) -> None:
    async with saver.lock:
        await saver.conn.execute(
            "INSERT OR REPLACE INTO thread_context VALUES (?, ?)", (thread_id, json.dumps(context))
        )
        await saver.conn.commit()


async def load_context(saver: AsyncSqliteSaver, thread_id: str) -> dict | None:
    async with saver.lock, saver.conn.execute(
        "SELECT context FROM thread_context WHERE thread_id = ?", (thread_id,)
    ) as cursor:
        row = await cursor.fetchone()
    return json.loads(row[0]) if row else None


async def list_threads(agent, saver: AsyncSqliteSaver) -> list[dict]:
    """Every saved thread, most recently used first, titled by its first message."""
    # Checkpoint ids sort by time.
    async with saver.lock, saver.conn.execute(
        "SELECT thread_id FROM checkpoints WHERE checkpoint_ns = '' "
        "GROUP BY thread_id ORDER BY MAX(checkpoint_id) DESC"
    ) as cursor:
        ids = [row[0] for row in await cursor.fetchall()]

    threads = []
    for thread_id in ids:
        state = await agent.aget_state(_config(thread_id))
        first = next((m for m in state.values.get("messages", []) if _is_user_message(m)), None)
        if first:
            title = " ".join(first.text.split())[:TITLE_CHARS]
            threads.append({"id": thread_id, "title": title, "updated_at": state.created_at})
    return threads


def to_turns(messages: list[BaseMessage]) -> list[dict]:
    """Saved messages as chat turns.

    Assistant turns are returned as the same events a live run streams (see
    agent/streaming.py), so the UI rebuilds them with the same code.
    """
    turns: list[dict] = []
    reply: dict | None = None
    for message in messages:
        if _is_user_message(message):
            turns.append({"id": message.id, "role": "user", "text": message.text})
            reply = None
            continue
        if message.type not in ("ai", "tool"):
            continue
        if reply is None:
            reply = {"id": message.id, "role": "assistant", "events": []}
            turns.append(reply)
        events = reply["events"]

        if message.type == "tool":
            events.append(
                {"type": "tool_result", "path": [], "id": message.tool_call_id,
                 "result": message.text, "is_error": message.status == "error"}
            )
            continue
        if message.text:
            events.append({"type": "text", "path": [], "message_id": message.id, "delta": message.text})
        for call in message.tool_calls:
            events.append(
                {"type": "tool_call", "path": [], "message_id": message.id,
                 "id": call["id"], "name": call["name"], "args": call["args"]}
            )
        for call in message.invalid_tool_calls:
            events.append(
                {"type": "tool_result", "path": [], "id": call["id"],
                 "result": f"Invalid tool call: {call['error']}", "is_error": True}
            )
        if usage := message.usage_metadata:
            events.append(
                {"type": "usage", "path": [], "input_tokens": usage["input_tokens"],
                 "output_tokens": usage["output_tokens"]}
            )
    return turns


async def load_thread(agent, saver: AsyncSqliteSaver, thread_id: str) -> dict | None:
    state = await agent.aget_state(_config(thread_id))
    messages = state.values.get("messages")
    if not messages:
        return None
    return {"turns": to_turns(messages), "context": await load_context(saver, thread_id)}
