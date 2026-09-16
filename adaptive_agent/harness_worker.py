"""JSON-line coding harness worker: plan, graph retrieve, file/command tools."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import tool

from adaptive_agent.code_graph import build_code_graph
from adaptive_agent.graph_retrieve import graph_retrieve
from adaptive_agent.llm import build_llm
from adaptive_agent.memory import ROOT
from adaptive_agent.router import route_task

SKIP = {".git", ".venv", "node_modules", ".next", "dist", "__pycache__"}
PLAN_SKILL = (ROOT / "skills" / "writing-plans-v1.md").read_text(encoding="utf-8")


def _safe(workspace: Path, rel: str) -> Path:
    cleaned = rel.replace("\\", "/").lstrip("/")
    if ".." in cleaned.split("/"):
        raise ValueError("path traversal rejected")
    abs_path = (workspace / cleaned).resolve()
    if abs_path != workspace.resolve() and workspace.resolve() not in abs_path.parents:
        raise ValueError("path traversal rejected")
    return abs_path


def emit(event: dict) -> None:
    sys.stdout.write(json.dumps(event) + "\n")
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


def make_tools(workspace: Path):
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

    return [list_dir, read_file, write_file, apply_patch, grep, run_command, search_graph]


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


def run_coding_agent(workspace: Path, prompt: str, history: list | None = None) -> dict:
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
    chosen = route_task("implement code " + prompt)
    tools = make_tools(workspace)
    agent = create_agent(
        model=build_llm(model=chosen.model, temperature=0.2),
        tools=tools,
        system_prompt=(
            f"{chosen.system_prompt}\n\n{PLAN_SKILL}\n\n"
            "Use tools. Prefer list_dir or search_graph, then read_file. "
            "If a file is missing, write_file instead of retrying read. "
            "When the user asks to add a file, write it with write_file. Do not only ask questions. "
            f"## Graph hits\n{ctx}"
        ),
    )
    tools_used: list[str] = []
    reply_parts: list[str] = []
    messages = _history_messages(history)
    if not messages or getattr(messages[-1], "content", None) != prompt:
        messages.append(HumanMessage(content=prompt))
    for mode, data in agent.stream(
        {"messages": messages},
        stream_mode=["messages", "updates"],
    ):
        if mode == "messages":
            token, meta = data if isinstance(data, tuple) else (data, {})
            node = (meta or {}).get("langgraph_node")
            if node == "tools":
                continue
            text = _chunk_text(token)
            if text:
                reply_parts.append(text)
                emit({"type": "token", "text": text})
            for call in getattr(token, "tool_calls", None) or []:
                name = call.get("name") if isinstance(call, dict) else getattr(call, "name", None)
                if name:
                    tools_used.append(name)
                    emit({"type": "tool", "name": name, "args": (call.get("args") if isinstance(call, dict) else {}) or {}})
        elif mode == "updates" and isinstance(data, dict) and "tools" in data:
            emit(_plan(inspect="done", edit="active"))
    emit(_plan(inspect="done", edit="done"))
    emit({"type": "done"})
    reply = "".join(reply_parts)
    return {
        "hits": [n.id for n, _ in retrieved["hits"]],
        "anchors": [a.id for a in retrieved["anchors"]],
        "tools": tools_used,
        "reply": reply,
    }


def cmd_run() -> None:
    line = sys.stdin.readline()
    if not line.strip():
        return
    msg = json.loads(line)
    if msg.get("type") != "start_run":
        return
    try:
        run_coding_agent(Path(msg["workspace"]), msg["prompt"], msg.get("history") or [])
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        emit({"type": "done"})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("cmd", choices=("graph", "retrieve", "run"))
    parser.add_argument("--query", default="")
    parser.add_argument("--workspace", default=str(ROOT))
    args = parser.parse_args()
    workspace = Path(args.workspace).resolve()
    if args.cmd == "graph":
        cmd_graph(workspace)
    elif args.cmd == "retrieve":
        cmd_retrieve(workspace, args.query or "code")
    else:
        cmd_run()


if __name__ == "__main__":
    main()
