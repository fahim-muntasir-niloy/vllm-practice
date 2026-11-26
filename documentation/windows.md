# Windows setup guide (WSL2)

vLLM only runs on Linux. On Windows, the model server runs inside WSL2 (Ubuntu), and the chat app runs on Windows.

```
Windows: browser ──► FastAPI :8001 ──► 127.0.0.1:8000 ──► WSL2 Ubuntu: vLLM ──► GPU
```

For the Linux (Fedora) setup, see [instructions.md](instructions.md). For how the chat app works, see [chat-ui.md](chat-ui.md).

## Working setup

| Component | Value |
|---|---|
| Host OS | Windows 11 |
| Linux | Ubuntu 26.04.1 LTS on WSL2 |
| GPU | NVIDIA GeForce RTX 3060 Laptop GPU, 6 GB |
| NVIDIA driver | `621.40` (Windows driver) |
| uv | `0.13.10` |
| Python | 3.12, managed by uv (pinned in `.python-version`) |
| Node.js | `26.13.1` |
| torch | `2.14.0+cu130` (WSL only) |
| vLLM | `0.33.0` (WSL only) |

There are two virtual environments:

| Where | Location | Contains |
|---|---|---|
| Windows | `.venv` in the project folder | the chat app (no vLLM) |
| Ubuntu | `~/venvs/vllm-app` | the chat app dependencies and vLLM |

`pyproject.toml` installs `vllm` only on Linux (`sys_platform == 'linux'`).

## First-time setup

### 1. Install WSL2 and Ubuntu

In an Administrator PowerShell:

```powershell
wsl --install -d Ubuntu
```

Restart if asked. If `wsl` then reports that no distributions are installed, run the command again. Create your Linux username and password when prompted.

Do not install an NVIDIA driver inside Ubuntu. WSL uses the Windows driver. Check that Ubuntu sees the GPU:

```powershell
wsl -d Ubuntu -- nvidia-smi
```

### 2. Install the tools in Ubuntu

Open Ubuntu (`wsl -d Ubuntu`), then run:

```bash
sudo apt update && sudo apt install -y build-essential
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env
```

### 3. Install vLLM in Ubuntu

From Ubuntu, replacing `<windows-user>` and the folder if yours differ:

```bash
cd /mnt/c/Users/<windows-user>/office/vllm-practice
UV_PROJECT_ENVIRONMENT=$HOME/venvs/vllm-app UV_HTTP_TIMEOUT=300 uv sync --frozen
```

Always set `UV_PROJECT_ENVIRONMENT` when running `uv sync` or `uv run` for this project in Ubuntu. Without it, uv uses the project's `.venv`, which belongs to Windows.

The download is several gigabytes.

### 4. Install the app on Windows

In PowerShell, from the project folder:

```powershell
uv sync
```

```powershell
cd frontend
npm ci
npm run build
cd ..
```

## Run it

1. **vLLM** (own PowerShell window, leave running):

   ```powershell
   wsl -d Ubuntu --cd '~' -- bash -lc 'source venvs/vllm-app/bin/activate && VLLM_USE_FLASHINFER_SAMPLER=0 vllm serve LiquidAI/LFM2.5-1.2B-Instruct --host 127.0.0.1 --gpu-memory-utilization 0.8 --max-model-len 8192'
   ```

   Wait for `Application startup complete`. The first start downloads the model.

2. **Chat app** (second PowerShell window, from the project folder):

   ```powershell
   uv run server/app.py
   ```

3. Open `http://localhost:8001`.

Test the model server on its own:

```powershell
uv run test-server.py
```

Press Ctrl+C in a window to stop that server.

### Why these flags

| Flag | Reason |
|---|---|
| `VLLM_USE_FLASHINFER_SAMPLER=0` | The FlashInfer sampler needs `nvcc`, which this setup doesn't install |
| `--host 127.0.0.1` | Keeps the unauthenticated API off your network; Windows can still reach it. Don't use `0.0.0.0` |
| `--gpu-memory-utilization 0.8` | The default (0.92) asks for more GPU memory than is free |
| `--max-model-len 8192` | Limits prompt plus reply to 8,192 tokens to suit a 6 GB GPU |

## Manage models

Models are stored inside Ubuntu, in the Hugging Face cache, not in the project folder.

| What | Path in Ubuntu |
|---|---|
| Cache | `~/.cache/huggingface/hub` |
| One model | `models--<org>--<name>` inside the cache |
| Weights files | `blobs` inside the cache |

A model's `snapshots` subfolder lists its files by name. Large entries such as `model.safetensors` are links into `blobs`.

To browse the cache from Windows:

```powershell
explorer.exe "\\wsl.localhost\Ubuntu\home\<linux-user>\.cache\huggingface\hub"
```

Run the commands below inside Ubuntu (`wsl -d Ubuntu`). First activate the environment, which provides the `hf` command:

```bash
source ~/venvs/vllm-app/bin/activate
```

### Download a model

`vllm serve <model-id>` downloads a model automatically the first time. To download it beforehand without starting the server:

```bash
hf download <model-id>
```

For example, `hf download LiquidAI/LFM2.5-1.2B-Instruct`. Add `--dry-run` to list the files without downloading them. Files already in the cache aren't downloaded again.

Gated or private models need you to sign in first with `hf auth login`.

### List downloaded models

```bash
hf cache ls
```

### Delete a model

1. Stop the vLLM server if it's using the model.
2. Preview what will be removed:

   ```bash
   hf cache rm model/<model-id> --dry-run
   ```

3. Delete it, and confirm when asked:

   ```bash
   hf cache rm model/<model-id>
   ```

For example, `hf cache rm model/LiquidAI/LFM2.5-1.2B-Instruct`.

Use `hf cache rm` instead of deleting the model folder by hand. The weights are stored separately in `blobs`, so deleting only the folder leaves them behind.

To clear out incomplete downloads and old revisions:

```bash
hf cache prune
```

Windows may not show the space as freed right away, because Ubuntu's virtual disk doesn't shrink automatically.

## Use a different model

1. Replace the model ID in the `vllm serve` command.
2. Before starting the chat app, set the same ID:

   ```powershell
   $env:VLLM_MODEL = "<model-id>"
   ```

3. Change the model ID in `test-server.py`, which has it hardcoded.

A larger model needs more of the 6 GB. If it doesn't fit, try a quantized version or a smaller `--max-model-len`.

## Configuration

The chat app reads `VLLM_BASE_URL`, `VLLM_MODEL` and `PORT` (see [chat-ui.md](chat-ui.md#configuration)). On Windows, `VLLM_BASE_URL` defaults to `http://127.0.0.1:8000/v1`. Set variables in PowerShell like this:

```powershell
$env:PORT = "8080"
```

## Problems we hit

### `nccl-extensions` can't be installed on Windows

- **Symptom:** `uv sync` fails with `Distribution nccl-extensions==0.2.0 ... can't be installed because it doesn't have a source distribution or wheel for the current platform`.
- **Cause:** vLLM and some of its dependencies are Linux only.
- **Fix:** `vllm` is marked as Linux only in `pyproject.toml`.

### `Free memory on device cuda:0 ... is less than desired GPU memory utilization`

- **Symptom:** The engine stops at startup with `Free memory on device cuda:0 (4.95/6.0 GiB) on startup is less than desired GPU memory utilization (0.92, 5.52 GiB)`.
- **Cause:** Not all of the GPU memory is free under WSL, even with no other GPU processes listed.
- **Fix:** Add `--gpu-memory-utilization 0.8`.

### Slow package download

- **Symptom:** `uv sync` in Ubuntu ran for well over an hour, often at about 1 MB/s on a 91 Mbps connection.
- **Cause:** Not confirmed. A single test download in Ubuntu was faster (3.3 MB/s), and uv had only one connection open.
- **What worked:** Leaving it to finish, with the computer awake.

### Harmless warnings in the log

- `torch._opaque_base is deprecated` and similar.
- `FlashInfer kernels are disabled`.
- `Pinned memory is not available on this platform`.
- `You are sending unauthenticated requests to the HF Hub`: set `HF_TOKEN` in Ubuntu for higher rate limits.
