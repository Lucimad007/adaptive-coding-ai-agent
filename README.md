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

## Desktop IDE (Electron)

```powershell
npm install
npm run dev
```

Opens an Electron window (Vite UI on `127.0.0.1:5173`, no Nest server). Pick a folder or set `WORKSPACE_ROOT`. Agent runs need `OPENCODE_API_KEY` and `.venv`.

Windows installer:

```powershell
npm run dist
```

Output is under `apps/desktop/release`.

Path-safety tests: `npm run test:desktop`. Worker: `python -m pytest tests/test_harness_worker.py`. Electron file-open smoke (Vite already running): `$env:RUN_ELECTRON=1; npm run test:e2e --workspace=@harness/web`.

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

## L4 retrieval

Audit/dedup the graph, then compare **keyword** search vs **anchor + PageRank** (the L4 notebook loop, without Oracle):

```powershell
python lessons/l4_code_graph.py
python lessons/l4_code_graph.py --repo C:\path\to\some-other-project
```

## Visual graph

Open an interactive HTML view (files, symbols, import / contains / call / co_edit, optional query walk):

```powershell
python -m adaptive_agent.graph_viz
python -m adaptive_agent.graph_viz --query "where do we verify a token?"
python -m adaptive_agent.graph_viz --repo C:\path\to\some-other-project
python -m adaptive_agent.graph_viz --repo C:\path\to\some-other-project --query "where is autoplay defined?"
```

## Tests

Unit tests (no API key, no live LLM):

```powershell
pip install -r requirements.txt
python -m pytest -q
```

L4 retrieval eval (multi-hop vs similarity, keywords vs code KG vs code KG sem):

```powershell
python lessons/l4_code_graph.py
```

## Adapter router

Frozen base model (OpenCode Go / DeepSeek Flash). The router snaps a small adapter onto it per task (`coding`, `refuse_unknowns`, `polite_persona`, `brand_voice`):

```powershell
python -m adaptive_agent.router "guess the unknown password"
python -m adaptive_agent.router "write a polite thank-you to the customer"
python -m adaptive_agent.router "landing page headline and brand tagline"
python -m adaptive_agent.router "implement the hash function" --run
```

## Config

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENCODE_API_KEY` | — | Required. Same key as OpenCode Zen/Go. |
| `OPENCODE_BASE_URL` | `https://opencode.ai/zen/go/v1` | OpenAI-compatible chat completions. |
| `OPENCODE_MODEL` | `deepseek-flash` | DeepSeek V4.1 Flash on Go. |

Other Go model ids if you want to switch: `deepseek-v4-pro`, `deepseek-v4-flash`.
