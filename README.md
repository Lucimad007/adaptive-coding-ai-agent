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

## Code-graph agent

A coding agent that extracts **import**, **function-call**, and **git co-edit** edges from **any** Python repo you point it at:

```powershell
python lessons/l3_code_graph.py --repo C:\path\to\some-other-project
python lessons/l3_code_graph.py --repo C:\path\to\some-other-project "What imports auth?"
```

Extractor only (no LLM):

```powershell
python -m adaptive_agent.code_graph --repo C:\path\to\some-other-project --out data\graphs\example.json
```

Keep the graph current (new commits → extract → MERGE into SQLite → PageRank re-rank). Once, or on an interval:

```powershell
python -m adaptive_agent.graph_sync --repo C:\path\to\some-other-project
python -m adaptive_agent.graph_sync --repo C:\path\to\some-other-project --interval 60
```

## Config

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENCODE_API_KEY` | — | Required. Same key as OpenCode Zen/Go. |
| `OPENCODE_BASE_URL` | `https://opencode.ai/zen/go/v1` | OpenAI-compatible chat completions. |
| `OPENCODE_MODEL` | `deepseek-flash` | DeepSeek V4.1 Flash on Go. |

Other Go model ids if you want to switch: `deepseek-v4-pro`, `deepseek-v4-flash`.
