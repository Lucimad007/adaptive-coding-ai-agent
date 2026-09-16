<p align="center">
  <img src="docs/screenshots/patchline-hero.png" alt="Patchline desktop IDE" width="100%" />
</p>

<h1 align="center">Patchline</h1>

<p align="center">
  A local coding desk that actually sees your repo — graph retrieval, Agent / Plan / Chat modes,<br />
  patch review, skill induction you Approve, and a real terminal. Powered by OpenCode Go.
</p>

<p align="center">
  <a href="https://github.com/Lucimad007/adaptive-coding-ai-agent"><img alt="repo" src="https://img.shields.io/badge/github-adaptive--coding--ai--agent-111111?style=flat-square" /></a>
  <img alt="stack" src="https://img.shields.io/badge/Electron-Vite-React-1e1e1e?style=flat-square" />
  <img alt="agent" src="https://img.shields.io/badge/LangChain-OpenCode%20Go-1e1e1e?style=flat-square" />
</p>

This repository is **adaptive-coding-ai-agent**: a Python LangChain worker plus **Patchline**, the Electron IDE that talks to it. The frozen base model is **DeepSeek Flash** on [OpenCode Go](https://opencode.ai/docs/go/). Adapters, a code graph, and human-gated skills sit on top — the model does not silently rewrite itself.

---

## Tour

Captures below are from the **running Electron app**, not generated mockups.

### Chat that runs tools, not a chatbot overlay

<img src="docs/screenshots/patchline-chat.png" alt="Agent chat with todos, tools, and skill Accept" width="100%" />

Chats are tabs. The composer is Agent / Plan / Chat (Shift+Tab). While the worker runs, send becomes stop. The agent streams tokens, tool calls (`read_file`, `apply_patch`, `search_graph`, …), Cursor-style todos, and — when a skill is drafted from traces — an **Accept / Reject** card. Nothing auto-activates.

### Plan mode (research → questions → markdown → Build)

<img src="docs/screenshots/patchline-plan.png" alt="Plan mode clarifying questions and Build" width="100%" />

Plan does not dump fake todos. It can ask clarifying questions, research the graph and files, write an editable markdown plan, then wait until you hit **Build**.

### Diffs you Accept or Undo

<img src="docs/screenshots/patchline-diffs.png" alt="Muted git diff with Accept and Undo" width="100%" />

Patches land in a Monaco diff with muted green/red and a review bar. Accept keeps the file; Undo restores the previous contents and records a trace.

### Code graph, fullscreen

<img src="docs/screenshots/patchline-graph.png" alt="Code graph walk" width="100%" />

Import, call, contains, and git co-edit edges. Retrieval walks PageRank from query anchors so the agent reads the right files first.

### Explorer git + ConPTY terminal

<p align="center">
  <img src="docs/screenshots/patchline-explorer.png" alt="File tree git badges" width="48%" />
  <img src="docs/screenshots/patchline-terminal.png" alt="Embedded terminal" width="48%" />
</p>

Git status badges in the tree. A real Windows ConPTY / PTY shell under the editor — not a fake log pane.

---

## What it does

| Surface | Behavior |
| --- | --- |
| **Agent** | Tools, todos, graph hits, file edits, skill proposals |
| **Plan** | Questions → research → markdown plan → **Build** |
| **Chat** | Workspace Q&A, lighter tools |
| **Images** | Paste/drop only if a **vision** model is configured; text-only models refuse paste |
| **Skills** | Failures/undos → pending skill → you Accept or Reject in chat |
| **Router** | Frozen base + adapters (`coding`, `refuse_unknowns`, `polite_persona`, `brand_voice`) |
| **Safety** | Workspace path checks, no `..` traversal, UTF-8 JSONL on Windows |

---

## Quick start

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
npm install
```

Put your OpenCode Go key in `.env` (`OPENCODE_API_KEY`). Get one at [opencode.ai/auth](https://opencode.ai/auth) after a Go subscription.

```powershell
npm run dev
```

Vite serves the UI on `127.0.0.1:5173`; Electron opens Patchline. Pick a folder or set `WORKSPACE_ROOT`. Agent runs need the key **and** `.venv`.

Windows installer:

```powershell
npm run dist
```

Artifacts land in `apps/desktop/release`.

---

## Layout

```
adaptive_agent/     LangGraph worker, graph, memory, skills, router
apps/web/           Vite + React + Monaco (Patchline UI)
apps/desktop/       Electron, IPC, ConPTY, python spawn
lessons/            L2 skill induction / L3–L4 graph walkthroughs
tests/              pytest (no live LLM required)
docs/screenshots/   README captures
```

The desktop process starts `python -m adaptive_agent.harness_worker run` with `PYTHONPATH` at the repo root, one worker per chat turn, JSONL events on stdout.

---

## Config

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENCODE_API_KEY` | — | Required |
| `OPENCODE_BASE_URL` | `https://opencode.ai/zen/go/v1` | Chat completions |
| `OPENCODE_MODEL` | `deepseek-flash` | Text coding default |
| `OPENCODE_VISION_MODEL` | unset | e.g. `deepseek-v4-flash-vision-exp` to allow image paste |
| `WORKSPACE_ROOT` | repo root | Folder Patchline opens |

Image paste is **off** unless `OPENCODE_MODEL` is a known vision id or `OPENCODE_VISION_MODEL` is set. DeepSeek Flash cannot see pixels; the UI blocks paste instead of ignoring the screenshot.

---

## Skills loop (L2)

Traces from runs and Undo → pending draft in SQLite (`data/agent.db`) → **Accept / Reject** in chat → Skill Box retrieval into the next system prompt.

CLI analog (no Oracle):

```powershell
python lessons/l2_skill_induction.py
python lessons/l2_skill_induction.py --decision reject --reason "not ready"
```

---

## Code graph (CLI)

```powershell
python -m adaptive_agent.code_graph --repo C:\path\to\project --out data\graphs\example.json
python -m adaptive_agent.graph_sync --repo C:\path\to\project
python -m adaptive_agent.graph_viz --query "where do we verify a token?"
python lessons/l3_code_graph.py --repo C:\path\to\project
python lessons/l4_code_graph.py
```

---

## Router

```powershell
python -m adaptive_agent.router "guess the unknown password"
python -m adaptive_agent.router "write a polite thank-you to the customer"
python -m adaptive_agent.router "implement the hash function" --run
```

Smoke the CLI agent:

```powershell
python agent.py
```

---

## Tests

```powershell
python -m pytest -q
npm run test:desktop
```

Electron file-open smoke (Vite already running):

```powershell
$env:RUN_ELECTRON=1; npm run test:e2e --workspace=@harness/web
```

---

## Stack

Electron 29, Vite 6, React 19, Monaco, LangChain / LangGraph, OpenCode Go (`ChatOpenAI` compatible). Windows stdin is UTF-8; the worker sanitizes lone surrogates so JSONL never blows up on cp1252.

---

## License

See the repository for license terms. Do not commit `.env` or local `data/agent.db` / eval scratch trees.
