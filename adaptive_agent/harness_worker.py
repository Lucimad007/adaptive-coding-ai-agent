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
from langchain_core.messages import HumanMessage
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


def make_tools(workspace: Path):
    @tool
    def read_file(path: str) -> str:
        """Read a text file from the workspace."""
        return _safe(workspace, path).read_text(encoding="utf-8")[:80_000]

    @tool
    def write_file(path: str, content: str) -> str:
        """Write a text file in the workspace."""
        target = _safe(workspace, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"wrote {path}"

    @tool
    def apply_patch(path: str, old: str, new: str) -> str:
        """Replace the first occurrence of old with new in a workspace file."""
        target = _safe(workspace, path)
        text = target.read_text(encoding="utf-8")
        if old not in text:
            return "old text not found"
        target.write_text(text.replace(old, new, 1), encoding="utf-8")
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
        graph = build_code_graph(workspace)
        result = graph_retrieve(graph, query, k=8, n_anchors=1)
        emit(_graph_event(graph, result))
        lines = [f"anchor={result['anchors'][0].id}" if result["anchors"] else "no anchor"]
        for node, score in result["hits"]:
            lines.append(f"{score:.3f} {node.id}")
        return "\n".join(lines)

    return [read_file, write_file, apply_patch, grep, run_command, search_graph]


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


def cmd_run() -> None:
    for line in sys.stdin:
        msg = json.loads(line)
        if msg.get("type") == "abort":
            break
        if msg.get("type") != "start_run":
            continue
        workspace = Path(msg["workspace"]).resolve()
        prompt = msg["prompt"]
        os.chdir(workspace)
        graph = build_code_graph(workspace)
        retrieved = graph_retrieve(graph, prompt, k=6, n_anchors=1)
        emit(_graph_event(graph, retrieved))
        emit(
            {
                "type": "plan",
                "steps": [
                    {"id": "1", "text": "Retrieve graph context", "status": "done"},
                    {"id": "2", "text": "Inspect relevant files", "status": "active"},
                    {"id": "3", "text": "Edit and verify", "status": "pending"},
                ],
            }
        )
        ctx = "\n".join(f"- {n.id}" for n, _ in retrieved["hits"])
        chosen = route_task("implement code " + prompt)
        tools = make_tools(workspace)
        agent = create_agent(
            model=build_llm(model=chosen.model, temperature=0.2),
            tools=tools,
            system_prompt=(
                f"{chosen.system_prompt}\n\n{PLAN_SKILL}\n\n"
                "Use tools. Prefer search_graph then read_file. "
                f"## Graph hits\n{ctx}"
            ),
        )
        result = agent.invoke({"messages": [HumanMessage(content=prompt)]})
        messages = result["messages"]
        for msg_obj in messages:
            for call in getattr(msg_obj, "tool_calls", None) or []:
                emit({"type": "tool", "name": call.get("name"), "args": call.get("args") or {}})
        emit({"type": "token", "text": str(messages[-1].content)})
        emit({"type": "done"})
        break


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
