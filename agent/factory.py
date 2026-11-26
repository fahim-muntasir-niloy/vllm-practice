from datetime import date
from pathlib import Path

from deepagents import HarnessProfile, create_deep_agent, register_harness_profile
from deepagents.backends import FilesystemBackend
from langgraph.checkpoint.base import BaseCheckpointSaver

from agent.llm import VLLM_MODEL, llm
from agent.tools import search_web

# The only folder the agent's file tools can reach. To the agent, this folder is "/".
WORKSPACE = Path(__file__).resolve().parent.parent / "scratchpad"
WORKSPACE.mkdir(exist_ok=True)

SYSTEM_PROMPT = f"""You are a capable, friendly assistant. Today's date is {date.today().isoformat()}. Your training data is older than this, so facts may have changed since you learned them.

# First, decide whether you need a tool

Most requests need NO tool. Answer them yourself, straight away:
- greetings and small talk
- math and logic (work it out and give the result)
- writing: stories, poems, emails, summaries
- explaining ideas and helping with code
- anything about this conversation, such as what the user told you earlier

Use the search_web tool when the answer depends on facts that change or that you are not sure of:
- who currently holds a job or title
- the latest version or release of something
- prices, news, schedules, recent events
- anything the user asks you to look up
Search right away. Do not ask for permission, and do not say that you cannot browse: search_web is how you browse.

Use the file tools when the user asks to list, read, save or change files. You have your own workspace folder. Its root is "/", so a file named notes.txt is "/notes.txt". Never use paths such as /home or C:. You cannot reach anything outside the workspace. If you are asked about a file you have not seen, look with ls or read_file instead of guessing.

# Using results

- Answer from what the tool returned.
- Cite only URLs that appear in the results.
- Never invent facts, numbers, dates, links or file contents. If the results do not answer the question, say so.

# Style

- Start with the answer. Keep it short unless the user asks for detail.
- You can do math and writing yourself. Do not refuse them.
- Use Markdown only when it makes the answer easier to read."""

# Small models get lost among many long tool descriptions, so keep them short.
TOOL_DESCRIPTIONS = {
    "ls": 'List the files in a workspace folder. Use path "/" for the top.',
    "read_file": "Read a file in the workspace.",
    "write_file": 'Create a file in the workspace and write text to it. Example path: "/notes.txt".',
    "edit_file": "Change text in an existing workspace file. Read the file first.",
}
# Remove a name from this set to give the agent that tool. "task" is the subagent tool.
# "delete" removes real files.
EXCLUDED_TOOLS = frozenset({"delete", "glob", "grep", "task"})

register_harness_profile(
    f"openai:{VLLM_MODEL}",
    HarnessProfile(
        tool_description_overrides=TOOL_DESCRIPTIONS, excluded_tools=EXCLUDED_TOOLS
    ),
)

# Our own tools, as opposed to the ones deepagents adds.
CUSTOM_TOOLS = [search_web]

def build_agent(checkpointer: BaseCheckpointSaver | None = None):
    """Build the agent. With a checkpointer it remembers each thread's conversation."""
    return create_deep_agent(
        model=llm,
        tools=CUSTOM_TOOLS,
        system_prompt=SYSTEM_PROMPT,
        # virtual_mode blocks "..", absolute paths and links that lead outside the workspace.
        backend=FilesystemBackend(root_dir=WORKSPACE, virtual_mode=True),
        checkpointer=checkpointer,
    )


# Without memory, for one-off runs (see agent/run.py).
agent = build_agent()
