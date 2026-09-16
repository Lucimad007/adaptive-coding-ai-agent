"""JSON-line coding harness worker: plan, graph retrieve, file/command tools."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import tool

from adaptive_agent.code_graph import build_code_graph
from adaptive_agent.graph_retrieve import graph_retrieve
from adaptive_agent.llm import build_llm, vision_chat_model
from adaptive_agent.memory import DEFAULT_DB, Memory, ROOT
from adaptive_agent.plan_gate import wait_for_answers, write_gate
from adaptive_agent.router import route_task
from adaptive_agent.skill_loop import (
    coding_topic,
    maybe_induce,
    propose_pending_skill,
    record_run_episode,
    retrieved_skills_block,
    tool_result_failed,
    wait_for_skill_review,
)
from adaptive_agent.skills import SkillBox

SKIP = {".git", ".venv", "node_modules", ".next", "dist", "__pycache__"}
PLAN_SKILL = (ROOT / "skills" / "writing-plans-v1.md").read_text(encoding="utf-8")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def _safe(workspace: Path, rel: str) -> Path:
    cleaned = rel.replace("\\", "/").lstrip("/")
    if ".." in cleaned.split("/"):
        raise ValueError("path traversal rejected")
    abs_path = (workspace / cleaned).resolve()
    if abs_path != workspace.resolve() and workspace.resolve() not in abs_path.parents:
        raise ValueError("path traversal rejected")
    return abs_path


def _sanitize_str(s: str) -> str:
    return "".join(ch if not (0xD800 <= ord(ch) <= 0xDFFF) else "\ufffd" for ch in s)


def _sanitize(obj):
    if isinstance(obj, str):
        return _sanitize_str(obj)
    if isinstance(obj, dict):
        return {str(k): _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj


def emit(event: dict) -> None:
    line = json.dumps(_sanitize(event), ensure_ascii=True) + "\n"
    data = line.encode("utf-8", errors="replace")
    try:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    except Exception:
        sys.stdout.write(line)
        sys.stdout.flush()


def _chunk_text(msg) -> str:
    content = getattr(msg, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text") or ""))
        return "".join(parts)
    return ""


def _plan(*, inspect: str, edit: str) -> dict:
    return {
        "type": "plan",
        "steps": [
            {"id": "1", "text": "Retrieve graph context", "status": "done"},
            {"id": "2", "text": "Inspect relevant files", "status": inspect},
            {"id": "3", "text": "Edit and verify", "status": edit},
        ],
    }


def _graph_event(graph, result) -> dict:
    return {
        "type": "graph",
        "nodes": [
            {"id": n.id, "kind": n.kind, "label": n.label, "path": n.path}
            for n in graph.nodes.values()
        ],
        "edges": [
            {"source": e.source, "target": e.target, "kind": e.kind, "weight": e.weight}
            for e in graph.edges.values()
        ],
        "walkIds": [n.id for n, _ in result["hits"]],
        "anchorId": result["anchors"][0].id if result["anchors"] else None,
    }


def _read_text(target: Path) -> str:
    if not target.exists():
        return f"error: {target.name} not found"
    if target.is_dir():
        return f"error: {target.name} is a directory; use list_dir"
    try:
        return target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return f"error: {target.name} is not utf-8 text"
    except OSError as exc:
        return f"error: {exc}"


def _skill_rel(path: str) -> bool:
    rel = path.replace("\\", "/").lstrip("/")
    return rel.startswith("skills/") and rel.endswith(".md")


def _emit_proposed_skill(event: dict, *, wait: bool) -> str:
    emit(event)
    emit({"type": "status", "text": "waiting for skill approval"})
    if not wait:
        return (
            f"proposed skill {event.get('name')} v{event.get('version')} "
            "(waiting for Accept in Patchline chat). Do not treat it as active yet."
        )
    status = wait_for_skill_review(
        name=str(event.get("name")),
        version=int(event.get("version") or 1),
        db_path=event.get("db_path"),
        timeout=300,
    )
    if status == "active":
        return f"user accepted skill {event.get('name')} v{event.get('version')}. Follow it from now on."
    if status == "rejected":
        return f"user rejected skill {event.get('name')}. Do not follow or rewrite it."
    return f"skill {event.get('name')} still pending (no decision yet). Stop and wait."


def make_tools(workspace: Path, db_path: Path | None = None, wait_skills: bool = False, wait_plan: bool = False):
    skill_db = db_path or DEFAULT_DB
    @tool
    def list_dir(path: str = ".") -> str:
        """List files and folders in a workspace directory."""
        try:
            target = _safe(workspace, path or ".")
        except ValueError as exc:
            return f"error: {exc}"
        if not target.exists():
            return f"error: {path} not found"
        if not target.is_dir():
            return f"error: {path} is a file"
        names = []
        for child in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if child.name in SKIP:
                continue
            names.append(f"{child.name}/" if child.is_dir() else child.name)
        return "\n".join(names) or "(empty directory)"

    @tool
    def read_file(path: str) -> str:
        """Read a text file from the workspace. Returns an error string if missing."""
        try:
            target = _safe(workspace, path)
        except ValueError as exc:
            return f"error: {exc}"
        text = _read_text(target)
        if text.startswith("error:"):
            return text
        return text[:80_000]

    @tool
    def write_file(path: str, content: str) -> str:
        """Create or overwrite a text file in the workspace (creates parent folders)."""
        try:
            target = _safe(workspace, path)
        except ValueError as exc:
            return f"error: {exc}"
        if _skill_rel(path):
            stem = Path(path.replace("\\", "/")).stem
            event = propose_pending_skill(name=stem, body=content, db_path=skill_db)
            return _emit_proposed_skill(event, wait=wait_skills)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        except OSError as exc:
            return f"error: {exc}"
        emit({"type": "fs", "op": "write", "path": path})
        emit(_plan(inspect="done", edit="active"))
        return f"wrote {path}"

    @tool
    def apply_patch(path: str, old: str, new: str) -> str:
        """Replace the first occurrence of old with new in a workspace file."""
        try:
            target = _safe(workspace, path)
        except ValueError as exc:
            return f"error: {exc}"
        if _skill_rel(path):
            text = _read_text(target)
            if text.startswith("error:"):
                body = new
            elif old not in text:
                return "old text not found"
            else:
                body = text.replace(old, new, 1)
            stem = Path(path.replace("\\", "/")).stem
            event = propose_pending_skill(name=stem, body=body, db_path=skill_db)
            return _emit_proposed_skill(event, wait=wait_skills)
        text = _read_text(target)
        if text.startswith("error:"):
            return text
        if old not in text:
            return "old text not found"
        try:
            target.write_text(text.replace(old, new, 1), encoding="utf-8")
        except OSError as exc:
            return f"error: {exc}"
        emit({"type": "fs", "op": "patch", "path": path})
        emit(_plan(inspect="done", edit="active"))
        return f"patched {path}"

    @tool
    def grep(pattern: str, glob: str = "*.py") -> str:
        """Search workspace files for a regex pattern."""
        rx = re.compile(pattern)
        hits: list[str] = []
        for file in workspace.rglob(glob):
            if any(p in SKIP for p in file.parts):
                continue
            try:
                text = file.read_text(encoding="utf-8")
            except OSError:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if rx.search(line):
                    rel = file.relative_to(workspace).as_posix()
                    hits.append(f"{rel}:{i}:{line[:200]}")
                    if len(hits) >= 40:
                        return "\n".join(hits)
        return "\n".join(hits) or "no matches"

    @tool
    def run_command(command: str) -> str:
        """Run an allowlisted command in the workspace (pytest, git, python)."""
        allowed = ("pytest", "python", "git", ".venv")
        if not any(command.strip().startswith(a) for a in allowed):
            return "command not allowlisted"
        proc = subprocess.run(
            command,
            cwd=workspace,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        return out[-8000:] or f"exit {proc.returncode}"

    @tool
    def search_graph(query: str) -> str:
        """Retrieve relevant code-graph nodes for a query (anchor + PageRank)."""
        try:
            graph = build_code_graph(workspace)
            result = graph_retrieve(graph, query, k=8, n_anchors=1)
        except Exception as exc:
            return f"error: graph search failed ({exc})"
        emit(_graph_event(graph, result))
        lines = [f"anchor={result['anchors'][0].id}" if result["anchors"] else "no anchor"]
        for node, score in result["hits"]:
            lines.append(f"{score:.3f} {node.id}")
        return "\n".join(lines)

    @tool
    def update_todos(todos: str) -> str:
        """Set the Cursor-style todo list shown above chat. Pass a JSON array of objects with id, content, and status (pending | in_progress | completed). Keep at most one in_progress."""
        try:
            raw = json.loads(todos)
        except json.JSONDecodeError:
            return "error: todos must be a JSON array"
        if not isinstance(raw, list):
            return "error: todos must be a JSON array"
        items = []
        for i, row in enumerate(raw[:24]):
            if isinstance(row, str):
                items.append({"id": str(i + 1), "content": row, "status": "pending"})
                continue
            if not isinstance(row, dict):
                continue
            status = str(row.get("status") or "pending").lower()
            if status not in {"pending", "in_progress", "completed"}:
                status = "pending"
            items.append(
                {
                    "id": str(row.get("id") or i + 1),
                    "content": str(row.get("content") or row.get("text") or "")[:240],
                    "status": status,
                }
            )
        emit({"type": "todos", "todos": items})
        return f"updated {len(items)} todos"

    @tool
    def propose_skill(name: str, body: str, rationale: str = "") -> str:
        """Propose a reusable skill. The user must Accept it in Patchline chat before it is active."""
        event = propose_pending_skill(name=name, body=body, rationale=rationale, db_path=skill_db)
        return _emit_proposed_skill(event, wait=wait_skills)

    @tool
    def ask_clarifying_questions(questions: str) -> str:
        """Ask the user 1-4 clarifying questions before writing a plan. Pass a JSON array of {id, prompt, options?} where options is an optional string list."""
        try:
            raw = json.loads(questions)
        except json.JSONDecodeError:
            return "error: questions must be a JSON array"
        if not isinstance(raw, list) or not raw:
            return "error: questions must be a non-empty JSON array"
        items = []
        for i, row in enumerate(raw[:4]):
            if isinstance(row, str):
                items.append({"id": str(i + 1), "prompt": row[:400], "options": []})
                continue
            if not isinstance(row, dict):
                continue
            opts = row.get("options") or []
            if not isinstance(opts, list):
                opts = []
            items.append(
                {
                    "id": str(row.get("id") or i + 1),
                    "prompt": str(row.get("prompt") or row.get("text") or "")[:400],
                    "options": [str(o)[:120] for o in opts[:8]],
                }
            )
        if not items:
            return "error: no valid questions"
        gate_id = str(uuid.uuid4())
        write_gate({"id": gate_id, "status": "waiting", "questions": items})
        emit({"type": "questions", "id": gate_id, "questions": items})
        if not wait_plan:
            return json.dumps({"id": gate_id, "status": "waiting"})
        answers = wait_for_answers(gate_id, timeout=300)
        return json.dumps(answers or {"status": "timeout"})

    @tool
    def create_plan(title: str, markdown: str, todos: str = "[]") -> str:
        """Publish the implementation plan for the user to edit and Build. markdown should include files to change, steps, and risks. todos is a JSON array of {id, content}."""
        try:
            raw = json.loads(todos) if todos else []
        except json.JSONDecodeError:
            raw = []
        items = []
        if isinstance(raw, list):
            for i, row in enumerate(raw[:24]):
                if isinstance(row, str):
                    items.append({"id": str(i + 1), "content": row[:240], "status": "pending"})
                elif isinstance(row, dict):
                    items.append(
                        {
                            "id": str(row.get("id") or i + 1),
                            "content": str(row.get("content") or row.get("text") or "")[:240],
                            "status": "pending",
                        }
                    )
        if items:
            emit({"type": "todos", "todos": items})
        emit(
            {
                "type": "plan_doc",
                "title": str(title or "Implementation plan")[:120],
                "markdown": str(markdown or "")[:20_000],
            }
        )
        return (
            "Plan published. Stop. The user will edit it and click Build. "
            "Do not write code until they switch to Agent with that plan."
        )

    return [
        list_dir,
        read_file,
        write_file,
        apply_patch,
        grep,
        run_command,
        search_graph,
        update_todos,
        propose_skill,
        ask_clarifying_questions,
        create_plan,
    ]


def tools_for_mode(workspace: Path, chat_mode: str):
    tools = {t.name: t for t in make_tools(workspace, wait_skills=True, wait_plan=True)}
    if chat_mode == "chat":
        names = ("list_dir", "read_file", "search_graph", "update_todos")
    elif chat_mode == "plan":
        names = (
            "list_dir",
            "read_file",
            "grep",
            "search_graph",
            "ask_clarifying_questions",
            "create_plan",
            "update_todos",
        )
    else:
        names = (
            "list_dir",
            "read_file",
            "write_file",
            "apply_patch",
            "grep",
            "run_command",
            "search_graph",
            "update_todos",
            "propose_skill",
        )
    return [tools[n] for n in names if n in tools]


MODE_PROMPT = {
    "agent": (
        "AGENT MODE: use tools. Call update_todos first with a JSON list of concrete steps "
        "(id, content, status), mark one in_progress, complete them as you go. "
        "Prefer list_dir or search_graph, then read_file. If a file is missing, write_file. "
        "When the user asks to add a file, write it with write_file. When the user asks to add a skill, call propose_skill. Never write skills/*.md as already-active; the user must Accept in chat."
    ),
    "plan": (
        "PLAN MODE (Cursor-style): you do not implement. Sequence:\n"
        "1) If the request is ambiguous, call ask_clarifying_questions once (JSON array of "
        "{id, prompt, options?}) and wait for the user's answers.\n"
        "2) Research the repo with search_graph, list_dir, read_file, grep. Name real files.\n"
        "3) Call create_plan with a markdown plan: overview, files to change (paths), "
        "implementation steps, risks/alternatives, and todos JSON.\n"
        "4) Stop. Do not write, patch, or run_command. The user edits the plan and clicks Build."
    ),
    "chat": (
        "CHAT MODE: answer questions about the workspace. You may list and read files. "
        "Do not write or patch files. Skip update_todos unless the user asks for a checklist."
    ),
}


def cmd_graph(workspace: Path) -> None:
    graph = build_code_graph(workspace)
    payload = graph.to_dict()
    payload["walkIds"] = []
    print(json.dumps(payload))


def cmd_retrieve(workspace: Path, query: str) -> None:
    graph = build_code_graph(workspace)
    result = graph_retrieve(graph, query, k=8, n_anchors=1)
    print(
        json.dumps(
            {
                "summary": graph.remembered_summary(workspace.name),
                "anchors": [a.id for a in result["anchors"]],
                "hits": [{"id": n.id, "score": s} for n, s in result["hits"]],
                "nodes": [
                    {"id": n.id, "kind": n.kind, "label": n.label, "path": n.path}
                    for n in graph.nodes.values()
                ],
                "edges": [
                    {"source": e.source, "target": e.target, "kind": e.kind, "weight": e.weight}
                    for e in graph.edges.values()
                ],
                "walkIds": [n.id for n, _ in result["hits"]],
                "anchorId": result["anchors"][0].id if result["anchors"] else None,
            }
        )
    )


def _resolve_images(images: list | None) -> list[dict]:
    """Load image bytes from IPC payload or temp files written by Electron."""
    import base64

    out: list[dict] = []
    for img in (images or [])[:4]:
        if not isinstance(img, dict):
            continue
        mime = str(img.get("mime") or "image/jpeg")
        path = str(img.get("path") or "").strip()
        raw = str(img.get("data") or "").strip()
        if path:
            p = Path(path)
            if p.is_file():
                raw = base64.b64encode(p.read_bytes()).decode("ascii")
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[-1]
        raw = "".join(raw.split())
        if not raw:
            continue
        out.append({"mime": mime, "data": raw})
    return out


def _user_message(prompt: str, images: list | None = None) -> HumanMessage:
    resolved = _resolve_images(images)
    text = (prompt or "").strip() or "See the attached image."
    if resolved:
        text = f"{text}\n\n[{len(resolved)} attached image(s). You can see them; answer from the pixels.]"
    parts: list[dict] = [{"type": "text", "text": text[:12_000]}]
    for img in resolved:
        mime = str(img.get("mime") or "image/jpeg")
        url = f"data:{mime};base64,{img['data']}"
        parts.append({"type": "image_url", "image_url": {"url": url}})
    if len(parts) == 1:
        return HumanMessage(content=text[:12_000])
    return HumanMessage(content=parts)


def _history_messages(history: list | None) -> list:
    out: list = []
    for item in (history or [])[-20:]:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        role = item.get("role")
        if role == "user":
            out.append(HumanMessage(content=text[:12_000]))
        elif role == "assistant":
            out.append(AIMessage(content=text[:12_000]))
    return out


def run_coding_agent(
    workspace: Path,
    prompt: str,
    history: list | None = None,
    chat_mode: str = "agent",
    images: list | None = None,
) -> dict:
    """One Patchline-style coding run. Emits JSONL events; returns retrieval + messages."""
    emit({"type": "status", "text": "running"})
    workspace = workspace.resolve()
    os.chdir(workspace)
    try:
        graph = build_code_graph(workspace)
        retrieved = graph_retrieve(graph, prompt, k=6, n_anchors=1)
    except Exception as exc:
        emit({"type": "error", "message": f"graph retrieve failed: {exc}"})
        graph = None
        retrieved = {"hits": [], "anchors": []}
    if graph is not None:
        emit(_graph_event(graph, retrieved))
    emit(_plan(inspect="active", edit="pending"))
    ctx = "\n".join(f"- {n.id}" for n, _ in retrieved["hits"])
    chat_mode = chat_mode if chat_mode in MODE_PROMPT else "agent"
    from adaptive_agent.router import route_task as route_prompt
    chosen = route_prompt("implement code " + prompt)
    vision = _resolve_images(images)
    if vision and not vision_chat_model():
        emit(
            {
                "type": "error",
                "message": (
                    "This model does not accept images. "
                    "Set OPENCODE_MODEL=deepseek-v4-flash-vision-exp "
                    "(or OPENCODE_VISION_MODEL) in .env, then restart."
                ),
            }
        )
        emit({"type": "done"})
        return {"hits": retrieved["hits"], "reply": ""}
    model_id = vision_chat_model() if vision else chosen.model
    if vision:
        emit({"type": "status", "text": f"vision {model_id}"})
    tools = tools_for_mode(workspace, chat_mode)
    box = SkillBox(DEFAULT_DB)
    try:
        box.seed_from_files()
        skill_block = retrieved_skills_block(box, prompt)
    except Exception:
        skill_block = ""
    agent = create_agent(
        model=build_llm(model=model_id, temperature=0.2 if chat_mode != "chat" else 0.4),
        tools=tools,
        system_prompt=(
            f"{chosen.system_prompt}\n\n{PLAN_SKILL}\n\n"
            f"{MODE_PROMPT[chat_mode]}\n"
            f"{skill_block}\n"
            f"## Graph hits\n{ctx}"
        ),
    )
    tools_used: list[str] = []
    tool_calls: list[dict] = []
    seen_tools: set[str] = set()
    failed = False
    error_bits: list[str] = []
    reply_parts: list[str] = []
    messages = _history_messages(history)
    messages.append(_user_message(prompt, vision))
    for stream_mode, data in agent.stream(
        {"messages": messages},
        stream_mode=["messages", "updates"],
    ):
        if stream_mode == "messages":
            token, meta = data if isinstance(data, tuple) else (data, {})
            node = (meta or {}).get("langgraph_node")
            if node == "tools":
                continue
            for call in getattr(token, "tool_calls", None) or []:
                name = call.get("name") if isinstance(call, dict) else getattr(call, "name", None)
                tid = str((call.get("id") if isinstance(call, dict) else getattr(call, "id", None)) or name or "")
                if not name or tid in seen_tools:
                    continue
                seen_tools.add(tid)
                tools_used.append(name)
                args = (call.get("args") if isinstance(call, dict) else getattr(call, "args", None)) or {}
                tool_calls.append({"name": name, "args": args})
                emit({"type": "tool", "name": name, "args": args})
            text = _chunk_text(token)
            if text:
                reply_parts.append(text)
                emit({"type": "token", "text": text})
        elif stream_mode == "updates" and isinstance(data, dict) and "tools" in data:
            emit(_plan(inspect="done", edit="active"))
            for msg in _tool_messages(data["tools"]):
                content = _chunk_text(msg) or str(getattr(msg, "content", "") or "")
                if tool_result_failed(content):
                    failed = True
                    error_bits.append(content[:400])
    if chat_mode != "chat":
        try:
            mem = Memory(DEFAULT_DB)
            record_run_episode(
                mem,
                workspace=workspace,
                task=prompt,
                tool_calls=tool_calls,
                failed=failed,
                error="; ".join(error_bits)[:800] if error_bits else None,
            )
            if failed:
                event = maybe_induce(mem, box, topic=coding_topic(workspace), prompt=prompt)
                if event:
                    emit(event)
        except Exception as exc:
            emit({"type": "error", "message": f"skill loop: {exc}"})
    emit(_plan(inspect="done", edit="done"))
    emit({"type": "done"})
    reply = "".join(reply_parts)
    return {
        "hits": [n.id for n, _ in retrieved["hits"]],
        "anchors": [a.id for a in retrieved["anchors"]],
        "tools": tools_used,
        "reply": reply,
    }


def _tool_messages(tools_update) -> list:
    if isinstance(tools_update, dict):
        msgs = tools_update.get("messages") or []
        return list(msgs) if isinstance(msgs, list) else [msgs]
    if isinstance(tools_update, list):
        return tools_update
    return []


def cmd_skills() -> None:
    from adaptive_agent.skill_loop import handle_skills_cmd

    line = sys.stdin.readline()
    if not line.strip():
        print(json.dumps({"ok": False, "error": "empty"}))
        return
    msg = _sanitize(json.loads(line))
    print(json.dumps(handle_skills_cmd(msg)))


def cmd_run() -> None:
    raw = sys.stdin.buffer.read()
    if not raw.strip():
        return
    msg = _sanitize(json.loads(raw.decode("utf-8")))
    if msg.get("type") != "start_run":
        return
    try:
            run_coding_agent(
                Path(msg["workspace"]),
                msg["prompt"],
                msg.get("history") or [],
                str(msg.get("mode") or "agent"),
                msg.get("images") or [],
            )
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        emit({"type": "done"})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("cmd", choices=("graph", "retrieve", "run", "skills"))
    parser.add_argument("--query", default="")
    parser.add_argument("--workspace", default=str(ROOT))
    args = parser.parse_args()
    workspace = Path(args.workspace).resolve()
    if args.cmd == "graph":
        cmd_graph(workspace)
    elif args.cmd == "retrieve":
        cmd_retrieve(workspace, args.query or "code")
    elif args.cmd == "skills":
        cmd_skills()
    else:
        cmd_run()


if __name__ == "__main__":
    main()
