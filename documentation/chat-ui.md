# Chat UI guide (React + FastAPI)

A simple chat app for the vLLM model. A React frontend (assistant-ui) talks to a FastAPI server, which calls vLLM through LangChain and streams the reply back. FastAPI serves the built frontend, so one process serves both the UI and the API.

```
browser ──► FastAPI :8001 ──┬── /            built React app (frontend/dist)
                            └── /api/chat ──► LangChain ChatOpenAI ──► vLLM 172.17.0.1:8000
```

## Project layout

```
vllm/
├── pyproject.toml          # Python deps (incl. fastapi, uvicorn, langchain-openai)
├── server/app.py           # FastAPI: /api/chat, /api/health, serves the UI
├── frontend/               # React + Vite + assistant-ui
│   ├── src/App.tsx         # chat UI and streaming adapter
│   ├── src/App.css         # styles
│   ├── vite.config.ts      # dev proxy and allowed hosts
│   └── dist/               # built UI (created by `npm run build`)
└── documentation/
```

## Requirements

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

Open the ngrok URL on your phone. Anyone with the URL can use the chat, and the model runs on your machine, so only share it with people you trust.

If you do tunnel the Vite dev server, add the ngrok host to `server.allowedHosts` in `frontend/vite.config.ts`. Vite blocks unknown hosts with `Blocked request. This host ... is not allowed.`

## Where to change things

- **Chat behavior** (system prompt, model options, agent logic): `server/app.py`, in `/api/chat`. The LangChain agent plugs in here. The frontend only needs the endpoint to stream plain text.
- **Chat UI** (layout, components): `frontend/src/App.tsx`.
- **Styling**: `frontend/src/App.css`.

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

