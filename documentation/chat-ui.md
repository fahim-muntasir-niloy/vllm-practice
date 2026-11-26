# Chat UI guide (React + FastAPI)

A chat app for a deep agent running on the vLLM model. A React frontend (assistant-ui) talks to a FastAPI server, which runs the agent and streams every step back. FastAPI serves the built frontend, so one process serves both the UI and the API.

```
browser ──► FastAPI :8001 ──┬── /            built React app (frontend/dist)
                            └── /api/chat ──► deep agent ──┬──► vLLM :8000
                                                           └──► Brave search
```

The agent needs `BRAVE_SEARCH_API_KEY` in `.env`, and vLLM must be started with tool calling: `--enable-auto-tool-choice --tool-call-parser lfm2` (see the command in [windows.md](windows.md#run-it); the parser depends on the model).

## Streaming

`/api/chat` returns newline-delimited JSON, one event per line:

| Event | Shows in the UI as |
|---|---|
| `text` | Reply text, token by token |
| `tool_call` | A tool card, with arguments filling in as the model writes them |
| `progress` | Live updates under a tool card |
| `tool_result` | The tool's result (open the card to see it) |
| `usage` | Token counts and time under the reply |
| `context` | The context panel on the right |
| `error` | An error message in the chat |

Every agent event has a `path`. It's empty for the main agent. For a subagent it holds the id of the `task` call that started it, so the UI nests that output inside the `task` card.

To send progress from a tool, call `emit_progress` from `agent/progress.py`:

```python
emit_progress({"message": "Step 1 done", "sources": [{"title": "...", "url": "..."}]})
```

## Memory

Each chat is a thread. The server saves its messages, tool calls and tool results with LangGraph's SQLite checkpointer in `.data/checkpoints.sqlite` (ignored by Git), so the context grows from turn to turn.

`/api/chat` takes only the new user message:

```json
{"thread_id": "abc", "message_id": "m2", "content": "hi again", "history": ["m1"]}
```

`history` lists the ids of the earlier user messages still on screen. If you regenerate or edit a message, the server removes that turn and everything after it before running. The old version isn't kept, so switching back to it in the UI doesn't restore it on the server.

### Chat list

The left sidebar lists saved threads, newest first, titled by their first message. Click one to reopen it. Reloading the page opens a new, empty chat.

| Endpoint | Returns |
|---|---|
| `GET /api/threads` | `id`, `title` and `updated_at` of every thread |
| `GET /api/threads/{id}` | The thread's turns and its latest context numbers |

Saved replies are rebuilt from memory as the same events a live run streams (`agent/history.py`). Run times and live progress messages aren't saved. Chats last used before the chat list was added show no context numbers until you send another message.

Leaving a chat while it's replying stops that reply.

There's no button to delete a chat yet. To clear all memory, stop the server and delete the `.data` folder.

### Token counts

- **Context** is the size of the main agent's latest model call plus its reply: how full the window is. The panel and the line under each reply show the same number.
- **Read** and **written** add up every model call in that run. A reply that uses a tool needs two calls, and each reads the conversation again, so **read** can be larger than **context**.

## Agent workspace and tools

The agent's file tools reach only the `scratchpad/` folder in the project, which it sees as `/`. Files there are real and stay between turns. Git ignores the folder.

The agent has `search_web`, `ls`, `read_file`, `write_file` and `edit_file`. `delete`, `glob`, `grep` and `task` (subagents) are turned off, because the small model did worse with more tools. Change `EXCLUDED_TOOLS` in `agent/factory.py` to turn them on.

## Context panel

The panel shows what fills the context window, counted with vLLM's `/tokenize` endpoint. If you change `--max-model-len`, set `VLLM_CONTEXT_TOKENS` to match (default `32768`). The agent compacts the conversation at 85% of that size.

## Tool UI

`frontend/src/toolkit.tsx` lists the tools that have their own look (a render-only assistant-ui toolkit). Icons and result views are in `frontend/src/agent/tool-views.tsx`.

Testing still to do is in [testing-todo.md](testing-todo.md).

## Project layout

```
vllm/
├── pyproject.toml          # Python deps (incl. fastapi, uvicorn, langchain-openai)
├── server/app.py           # FastAPI: /api/chat, /api/health, serves the UI
├── agent/                  # factory.py, llm.py, tools.py, streaming.py, memory.py, history.py, context.py
├── frontend/               # React + Vite + assistant-ui
│   ├── src/App.tsx         # chat UI and streaming adapter
│   ├── src/agent/          # event handling and the tool card
│   ├── src/index.css       # styles
│   ├── vite.config.ts      # dev proxy and allowed hosts
│   └── dist/               # built UI (created by `npm run build`)
└── documentation/
```

## Requirements

The commands and addresses below are for Linux. On Windows, follow [windows.md](windows.md).

- vLLM running with the flags in [instructions.md](instructions.md). It listens on `172.17.0.1:8000`.
- Node.js 22+ and npm (for the frontend).
- uv (for the Python side).

## Run it

1. **vLLM** (own terminal, leave running):

   ```bash
   VLLM_USE_FLASHINFER_SAMPLER=0 vllm serve LiquidAI/LFM2.5-1.2B-Instruct --host 172.17.0.1
   ```

2. **Build the frontend** (once, and after any change in `frontend/src`):

   ```bash
   cd /home/fmn/programming/vllm/frontend
   npm install      # first time only
   npm run build
   ```

3. **Start the server** (leave running):

   ```bash
   cd /home/fmn/programming/vllm
   uv run server/app.py
   ```

4. Open `http://localhost:8001`.

Check the API directly with `curl localhost:8001/api/health`.

## Configuration

Set these environment variables before starting the server:

| Variable | Default | Purpose |
|---|---|---|
| `VLLM_BASE_URL` | `http://172.17.0.1:8000/v1` | vLLM OpenAI-compatible endpoint |
| `VLLM_MODEL` | `LiquidAI/LFM2.5-1.2B-Instruct` | Model name sent to vLLM |
| `PORT` | `8001` | Port for `uv run server/app.py` |

Example: `PORT=8080 uv run server/app.py`.

## Development mode (optional)

For hot reload while changing the UI, run the Vite dev server in a second terminal:

```bash
cd /home/fmn/programming/vllm/frontend
npm run dev        # http://localhost:5173
```

Vite forwards `/api` to `localhost:8001`, so the FastAPI server must be running too.

## Phone access

Tunnel the FastAPI port, not the Vite dev server:

```bash
ngrok http 8001
```

Open the ngrok URL on your phone. Anyone with the URL can use the chat. The model runs on your machine and the agent's searches use your Brave API key, so only share it with people you trust.

If you do tunnel the Vite dev server, add the ngrok host to `server.allowedHosts` in `frontend/vite.config.ts`. Vite blocks unknown hosts with `Blocked request. This host ... is not allowed.`

## Where to change things

- **Agent behavior** (system prompt, tools, subagents): `agent/factory.py`. Model options: `agent/llm.py`.
- **Stream events**: `agent/streaming.py`, with the matching types in `frontend/src/agent/stream.ts`.
- **Tool cards**: `frontend/src/agent/tool-call.tsx`.
- **Chat UI** (layout, components): `frontend/src/App.tsx`.
- **Styling**: `frontend/src/index.css`.

## Problems we hit

### `uv run server/app.py` did nothing

- **Symptom:** The command returned right away with no output.
- **Cause:** The file only defined the FastAPI app and never started the server.
- **Fix:** Added an `if __name__ == "__main__":` block that calls `uvicorn.run(...)`.

### `assistant-ui create` and `setup` refused to run

- **Symptom:** The CLI printed that it's running as a coding agent and to use `setup` instead, which opens a browser flow.
- **Cause:** The CLI blocks automated runs.
- **Fix:** Installed the packages with npm (`@assistant-ui/react`, `@assistant-ui/react-markdown`) and wrote the components by hand against the primitives (`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`).

### `Blocked request. This host ... is not allowed.`

- **Symptom:** Opening the ngrok URL shows Vite's blocked-host error.
- **Cause:** The tunnel points at the Vite dev server, which only accepts known hosts.
- **Fix:** Add the host to `server.allowedHosts` in `frontend/vite.config.ts`, or tunnel port 8001 instead (recommended).

