"""Custom progress updates that tools send to the stream."""

from langgraph.config import get_config, get_stream_writer


def emit_progress(data: dict) -> None:
    """Send a progress update for the tool call that is running now.

    Does nothing outside an agent run, so tools still work when called directly.
    """
    try:
        writer = get_stream_writer()
        # The last segment looks like "tools:<task id>" and identifies this tool call.
        namespace = get_config()["metadata"]["langgraph_checkpoint_ns"]
    except (RuntimeError, KeyError):
        return
    writer({"task": namespace.split("|")[-1].split(":")[-1], "data": data})
