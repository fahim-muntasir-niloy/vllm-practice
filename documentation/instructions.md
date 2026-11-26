# vLLM Setup and Operations Guide

## Current working setup

| Component | Value |
|---|---|
| Host OS | Fedora 45 (Linux) |
| Kernel in use | `7.2.15-200.fc44.x86_64` (pinned as GRUB default) |
| GPU | NVIDIA GeForce RTX 3060 Mobile / Max-Q (GA106M) |
| Also present | AMD Cezanne integrated GPU (not used by vLLM) |
| NVIDIA driver | `615.71.09` (RPM packages, prebuilt kmod for 7.2.15-200.fc44) |
| Python | System Python 3.12 (`/usr/lib64/python3.12`), venv at `.venv` |
| torch | `2.14.0+cu130` |
| vLLM | `0.33.0` (PyPI wheel) |
| Project file | `pyproject.toml` (project name `vllm-app`), `uv.lock` |

## Start the server

```bash
VLLM_USE_FLASHINFER_SAMPLER=0 vllm serve LiquidAI/LFM2.5-1.2B-Instruct --host 172.17.0.1
```

The server listens on `http://172.17.0.1:8000/v1`, the Docker bridge address. This keeps the API off other devices on your network, and the chat UI reaches it there by default.

**Do not use `--host 0.0.0.0`.** Without `--host`, vLLM listened on `0.0.0.0:8000`, which exposes the unauthenticated API to your whole LAN.

Test it:

```bash
curl localhost:8000/v1/models
```

Use it from LangChain:

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://localhost:8000/v1",
    api_key="not-needed",
    model="LiquidAI/LFM2.5-1.2B-Instruct",
)
```

## Python environment (uv)

```bash
uv add <package>   # add a dependency to pyproject.toml and install it
uv sync            # install everything in pyproject.toml / uv.lock
uv sync --dry-run  # preview changes without touching .venv
```

`vllm==0.33.0` is declared in `pyproject.toml`, so `uv sync` keeps it installed. Any package that is installed but not declared will be removed by `uv sync`.

## Problems we hit and how they were fixed

### 1. `Failed to infer device type` / `No module named vllm._C`

- **Symptom:** `vllm` CLI crashes on startup with `RuntimeError: Failed to infer device type`, and `Failed to import from vllm._C`.
- **Cause:** The NVIDIA driver was not loaded, so torch saw no CUDA device. The `vllm._C` import failure was a side effect of the same environment problem.
- **Fix:** Get the driver working first (see item 2).

### 2. NVIDIA driver not loaded on the newest kernel

- **Symptom:** `nvidia-smi` fails with "couldn't communicate with the NVIDIA driver". `lsmod | grep nvidia` shows nothing. `nouveau` loads instead.
- **Cause:** `akmod-nvidia` 615.71.09 failed to build for the running kernel `7.3.3-300.fc45`. The build log in `/var/cache/akmods/nvidia/615.71.09-3-for-7.3.3-300.fc45.x86_64.failed.log` shows a compile error: `dmem_cgroup_register_region` is called with an incompatible signature (kernel API change).
- **Fix:** Boot the kernel that has a working module, `7.2.15-200.fc44`, and make it the default:

  ```bash
  sudo grubby --set-default /boot/vmlinuz-7.2.15-200.fc44.x86_64
  sudo grubby --default-kernel
  ```

  Verify after reboot: `uname -r` and `nvidia-smi`.

### 3. Triton fails with `Python.h: No such file or directory`

- **Symptom:** During `torch.compile`, the engine dies with `fatal error: Python.h: No such file or directory` while Triton builds `cuda_utils`.
- **Cause:** Python development headers were not installed for the system Python 3.12.
- **Fix:**

  ```bash
  sudo dnf install -y python3.12-devel
  ```

### 4. FlashInfer sampler fails: `Could not find nvcc`

- **Symptom:** `RuntimeError: Could not find nvcc and default cuda_home='/usr/local/cuda' doesn't exist` during the first sampling step (`flashinfer` JIT build).
- **Cause:** FlashInfer's top-k/top-p sampler compiles a kernel at runtime and needs the CUDA toolkit (`nvcc`), which is not installed.
- **Fix:** Disable the FlashInfer sampler:

  ```bash
  VLLM_USE_FLASHINFER_SAMPLER=0 vllm serve ...
  ```

### 5. Harmless warnings in the log

- `torch._opaque_base is deprecated` and similar: from torch, safe to ignore.
- `Can't initialize NVML`: appears when the driver is not loaded. It should go away once the driver works.
- `FlashInfer kernels are disabled: flashinfer-cubin is not installed and nvcc ... or ninja ... is missing`: vLLM falls back to FlashAttention. Safe to ignore unless you need FlashInfer kernels.
- `Warning: You are sending unauthenticated requests to the HF Hub`: set `HF_TOKEN` for higher rate limits.

### 6. Slow first start

- Weight download plus torch compile took several minutes on the first run (weights download was about 285 seconds). Later starts reuse the cache at `~/.cache/vllm/torch_compile_cache` and load in well under a minute.

### 7. `uv add` / `uv sync` did not work at first

- **Symptom:** `No pyproject.toml found`.
- **Cause:** The repo had no `pyproject.toml`. vLLM had been installed into `.venv` with pip, not from this project.
- **Fix:** `uv init --bare --no-workspace`, then `uv add`.
- **Second problem:** The project name `vllm` matched the `vllm` package, so uv refused `vllm==0.33.0` as a self-dependency. Renamed the project to `vllm-app` in `pyproject.toml`.

## Chat UI

The chat UI (React + FastAPI, served on port 8001) has its own guide: [chat-ui.md](chat-ui.md).

## Recommendations

1. **Make the env var permanent.** Add `export VLLM_USE_FLASHINFER_SAMPLER=0` to `~/.zshrc`, or keep using the prefix in the start command.
2. **Keep the working kernel pinned.** Before a kernel update, confirm the NVIDIA module builds for the new kernel. After any kernel or driver update, check `nvidia-smi` before starting vLLM. If the module fails to build, boot `7.2.15-200.fc44`.
3. **Install the CUDA toolkit if you want the FlashInfer warnings gone.** `nvcc` and `ninja` need to match torch's CUDA version (cu130). That is a large install. Only do it if you need FlashInfer kernels.
4. **Set `HF_TOKEN`** to avoid rate limits and speed up downloads.
5. **Always use `uv sync --dry-run` before `uv sync`.** Undeclared packages in `.venv` are removed by `uv sync`, including `vllm` if it were ever dropped from `pyproject.toml`.
6. **Keep `uv.lock` in version control** once the repo gets its first commit, so the environment is reproducible.
7. **Watch the vLLM and torch versions together.** `vllm==0.33.0` was installed with `torch 2.14.0+cu130`. Upgrading one without the other can break the `_C` extension again.
