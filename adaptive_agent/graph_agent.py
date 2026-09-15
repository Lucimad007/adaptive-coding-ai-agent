"""Coding agent that extracts import, call, and co-edit edges from any Python repo."""

from __future__ import annotations

import argparse
from pathlib import Path

from langchain.agents import create_agent
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

from adaptive_agent.code_graph import build_code_graph, format_preview, save_graph
from adaptive_agent.llm import build_llm
from adaptive_agent.memory import ROOT

_GRAPHS: dict[str, object] = {}


def _load(repo_path: str):
    root = Path(repo_path).expanduser().resolve()
    key = str(root)
    if key not in _GRAPHS:
        _GRAPHS[key] = build_code_graph(root)
    return root, _GRAPHS[key]


@tool
def extract_code_graph(repo_path: str) -> str:
    """Parse a target Python git repo and build a code knowledge graph.

    Creates three relation types:
    - import: file A imports file B
    - calls: function/file A calls function B
    - coedit: files changed together in git history

    Pass the path of the codebase to analyze, not this agent project unless asked.
    """
    root, graph = _load(repo_path)
    _GRAPHS[str(root)] = graph
    slug = root.name.replace(" ", "_")
    out = ROOT / "data" / "graphs" / f"{slug}.json"
    save_graph(graph, out)
    return f"Extracted graph for {root}\n{graph.summary()}\nSaved {out}"


@tool
def list_graph_edges(repo_path: str, kind: str = "import", limit: int = 25) -> str:
    """List extracted edges of one kind: import, calls, coedit, or defines."""
    _, graph = _load(repo_path)
    kind = kind.strip().lower()
    rows = [e for e in graph.edges.values() if e.kind == kind]
    if not rows:
        return f"No {kind} edges. Known kinds: import, calls, coedit, defines."
    lines = [f"{kind} edges: {len(rows)}"]
    for edge in rows[: max(1, limit)]:
        lines.append(f"{edge.source} -> {edge.target}  w={edge.weight:g}")
    return "\n".join(lines)


@tool
def graph_neighbors(repo_path: str, query: str, limit: int = 15) -> str:
    """Find graph nodes matching a name and list their incoming/outgoing edges."""
    _, graph = _load(repo_path)
    q = query.lower()
    hits = [n for n in graph.nodes.values() if q in n.id.lower() or q in n.label.lower()]
    if not hits:
        return f"No nodes matching {query!r}."
    lines: list[str] = []
    for node in hits[:8]:
        lines.append(f"node {node.id} ({node.kind})")
        related = [
            e
            for e in graph.edges.values()
            if e.source == node.id or e.target == node.id
        ]
        for edge in related[:limit]:
            lines.append(f"  [{edge.kind}] {edge.source} -> {edge.target}  w={edge.weight:g}")
    return "\n".join(lines) or "No edges."


def build_graph_agent():
    return create_agent(
        model=build_llm(),
        tools=[extract_code_graph, list_graph_edges, graph_neighbors],
        system_prompt=(
            "You are a code-graph agent. The user gives a path to SOME OTHER codebase "
            "and a question. First extract_code_graph on that path, then use "
            "list_graph_edges and graph_neighbors to answer. Explain import, call, "
            "and co-edit relations. Do not assume the repo is this adaptive-ai-agent "
            "project unless the user passes that path."
        ),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Agent that builds a code graph for a target repo")
    parser.add_argument("--repo", required=True, help="Path to the codebase to graph")
    parser.add_argument(
        "question",
        nargs="*",
        help="Optional question. Default: extract all three edge types and summarize.",
    )
    args = parser.parse_args()
    repo = str(Path(args.repo).expanduser().resolve())
    question = " ".join(args.question).strip() or (
        f"Extract import, function-call, and git co-edit edges from {repo}. "
        "Summarize the graph and show a few examples of each edge type."
    )
    agent = build_graph_agent()
    result = agent.invoke(
        {
            "messages": [
                HumanMessage(content=question),
            ]
        }
    )
    print(result["messages"][-1].content)


if __name__ == "__main__":
    main()
