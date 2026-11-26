# Testing to-do

Parked testing work, to come back to later. The current model (`LiquidAI/LFM2.5-1.2B-Instruct`) isn't expected to hold up, so most of this is worth running again with a stronger model.

## Model and agent harness

- [ ] Pick a stronger tool-calling model that fits 6 GB, and set its `--tool-call-parser`
- [ ] Rerun the cases below on the new model
- [ ] Find a tool set that keeps file tools without confusing the model
- [ ] Test the subagent tool (`task`) with a real model; it is excluded for now
- [ ] Test `glob`, `grep` and `delete`; they are excluded for now
- [ ] Test long conversations past 85% of the context window, to check compaction
- [ ] Re-measure the final prompt in `agent/factory.py` (the path wording changed after the last full run)

### Cases

| Case | Question | Pass when |
|---|---|---|
| math | What is 17 * 24? | Answers 408 without a tool |
| story | Write a short story about a lighthouse | Writes it without a tool |
| memory | Say a favourite colour, then ask for it | Answers from the conversation |
| hello | hi there | Replies without a tool |
| office | Who is the current UN Secretary-General? | Searches, then answers |
| version | What is the latest vLLM release? | Searches, then answers |
| price | How much does an RTX 5090 cost? | Searches, then answers |
| list | What files are in the workspace? | Calls `ls` or `glob` |
| read | What does /notes.txt say? | Calls `read_file` and reports the text |
| save | Save "hello world" to /hello.txt | The file exists in the workspace |
| edit | In /notes.txt, change banana to mango | The file changes |

### Results so far (LFM2.5-1.2B, 4 tries per case, stand-in search tool)

| Setup | Temperature 0.1 | Temperature 0.7 |
|---|---|---|
| First prompt, all tools (7 cases) | not run | 3/28 |
| Longer prompt, all tools (8 cases) | 4/32 | 7/32 |
| Longer prompt, short tool descriptions (8 cases) | 16/32 | 14/32 |
| Longer prompt, search + read + write (8 cases) | 25/32 | 24/32 |
| Longer prompt, search only (8 cases; `save` can't pass) | 28/32 | 27/32 |
| Workspace prompt, ls + read + write + edit (11 cases) | 32/44 | 30/44 |
| Workspace prompt, all file tools except delete (11 cases) | 28/44 | partly run |

The `save` case in the first workspace run wrote to `/home/user/...`. The prompt and the `write_file` description now say to use paths such as `/notes.txt`.

## Fine-tuning for tool calling

Goal: better decisions about **when** to call a tool, not only the call format. The first 28-run stress test had no invalid calls; the model refused tasks, skipped searches it needed, or called tools it didn't need. Measure first, then fine-tune.

### 1. Eval set

- [ ] Write 50–100 cases that are never used for training
- [ ] Score: right tool, right arguments, no tool when none is needed, correct answer from the result

### 2. Baselines

- [ ] Run the eval set on LFM2.5-1.2B
- [ ] Run it on two or three stronger models that fit 6 GB
- [ ] Check for a tool-focused LFM2 1.2B variant from Liquid AI (not verified that it exists)

### 3. Training data

- [ ] Use this project's exact tool schemas and system prompt
- [ ] Start with 500–2,000 examples:

  | Type | Share |
  |---|---|
  | Should call a tool | 40% |
  | Should not call one (math, writing, memory) | 30% |
  | Answer from a tool result | 20% |
  | Failed or empty results | 10% |

- [ ] If mixing in public tool-calling sets, check they don't teach the model to always call a tool
- [ ] If a stronger model writes examples, review them and check its license terms
- [ ] Format with the model's own chat template; pass tool arguments as an object, not a JSON string

### 4. Train and compare

- [ ] LoRA or QLoRA, with vLLM stopped to free the GPU
- [ ] Check early that vLLM can load a LoRA adapter for this model; otherwise merge it into the weights
- [ ] Compare on the eval set with all tools turned on

Fine-tuning can improve tool choice, but it won't reliably stop wrong facts.

## Streaming and UI

- [ ] Subagent display with a real model (only tested with a scripted model)
- [ ] Parallel subagents
- [ ] Stop button during a real web search
- [ ] Context panel numbers after compaction
- [ ] Narrow and phone-sized screens
- [ ] Approval prompts (human-in-the-loop) are not set up
- [ ] Reasoning output from thinking models is not handled
