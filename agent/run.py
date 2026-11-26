"""Ask the agent one question and print every step.

Usage: uv run python -m agent.run "your question"
"""

import asyncio
import sys

from agent.factory import agent

MAX_PRINT_CHARS = 600
# Caps the agent loop so a confused model can't call tools forever.
RECURSION_LIMIT = 25


async def main() -> None:
    # Windows consoles may not be UTF-8, and search results often contain other characters.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    if len(sys.argv) < 2:
        sys.exit(__doc__)
    question = " ".join(sys.argv[1:])

    # The search tool is async only, so the agent has to run async too.
    async for update in agent.astream(
        {"messages": [{"role": "user", "content": question}]},
        {"recursion_limit": RECURSION_LIMIT},
        stream_mode="updates",
    ):
        for node_output in update.values():
            if not node_output:
                continue
            messages = node_output.get("messages", [])
            # Some middleware wraps the list in an object that replaces the history.
            for message in getattr(messages, "value", messages):
                print_message(message)


def print_message(message) -> None:
    if message.type == "ai":
        for call in message.tool_calls:
            print(f"\n[tool call] {call['name']}({call['args']})")
        for call in message.invalid_tool_calls:
            print(f"\n[invalid tool call] {call['name']}: {call['args']}")
        if message.content:
            print(f"\n[assistant] {message.text}")
        if message.usage_metadata:
            usage = message.usage_metadata
            print(f"[tokens] in={usage['input_tokens']} out={usage['output_tokens']}")
    elif message.type == "tool":
        print(f"\n[tool result: {message.name}]\n{str(message.content)[:MAX_PRINT_CHARS]}")


if __name__ == "__main__":
    asyncio.run(main())
