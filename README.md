# Adaptive AI Agent

LangChain agent on **DeepSeek V4.1 Flash** (`deepseek-flash`) through **OpenCode Go**, plus an L2-style **skill induction** loop (traces → draft skill → human review → Skill Box).

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Put your OpenCode Go key in `.env`:

```
OPENCODE_API_KEY=sk-...
```

Get a key from [OpenCode auth](https://opencode.ai/auth) after subscribing to Go.

## Smoke test

```powershell
python agent.py
```

## L2 skill induction

Walkthrough analog of DeepLearning.AI Adaptive AI Agents lesson 2 (without Oracle / `course_lab`):

```powershell
python lessons/l2_skill_induction.py
```

Defaults to **approve**. To reject the proposal:

```powershell
python lessons/l2_skill_induction.py --decision reject --reason "not ready"
```

## Code graph

Build a graph of this repo from **import** edges, **function-call** edges, and **git co-edit** edges:

```powershell
python lessons/l3_code_graph.py
```

Writes `data/code_graph.json`.

## Config

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENCODE_API_KEY` | — | Required. Same key as OpenCode Zen/Go. |
| `OPENCODE_BASE_URL` | `https://opencode.ai/zen/go/v1` | OpenAI-compatible chat completions. |
| `OPENCODE_MODEL` | `deepseek-flash` | DeepSeek V4.1 Flash on Go. |

Other Go model ids if you want to switch: `deepseek-v4-pro`, `deepseek-v4-flash`.
