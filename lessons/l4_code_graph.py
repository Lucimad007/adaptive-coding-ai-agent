"""L4 analog: audit, dedup, then keyword vs anchor+PageRank retrieval."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from adaptive_agent.code_graph import Node, build_code_graph
from adaptive_agent.graph_retrieve import (
    audit,
    dedup,
    graph_retrieve,
    match_edges,
    narrate_retrieval_comparison,
    render_anchor_walk,
    run_retrieval_eval,
    starter_code_graph,
)

SAMPLE = ROOT / "fixtures" / "sample_codebase"

EASY = "where is autoplay defined?"
MULTI_HOP = "How do I improve the autoplay button for clipping?"


def _print_hits(title: str, rows: list) -> None:
    print(title)
    for node, score in rows:
        print(f"  {score:.4f}  {node.id}")


def main() -> None:
    parser = argparse.ArgumentParser(description="L4 code-graph retrieval walkthrough")
    parser.add_argument("--repo", default=str(SAMPLE), help="Target codebase (default: sample fixture)")
    args = parser.parse_args()
    repo = Path(args.repo).resolve()

    print("== Starter graph: word-match anchor, then walk ==")
    starter = starter_code_graph()
    print(render_anchor_walk(starter, 'where do we verify a token?'))
    html = ROOT / "data" / "graphs" / "starter_anchor_walk.html"
    from adaptive_agent.graph_viz import write_anchor_walk_html

    write_anchor_walk_html(starter, "where do we verify a token?", html)
    print(f"\nVisual graph: {html}")
    print()

    print("== The codebase the agent remembers ==")
    raw = build_code_graph(repo)
    print(raw.remembered_summary(repo.name))
    print(audit(raw).format("BEFORE"))

    print("\n== MATCH every typed edge ==")
    for edge in match_edges(raw)[:20]:
        print(f"  [{edge.kind}] {edge.source} -> {edge.target}")

    print("\n== Dedup ==")
    clean = dedup(raw)
    print(audit(clean).format("AFTER"))

    print("\n== Add one node (cheap append) ==")
    extra = Node(id="fn:rerank_hits", kind="function", label="rerank_hits", path="app.py")
    clean.add_node(extra)
    if "fn:app.py:get_feed" in clean.nodes:
        clean.add_edge("fn:app.py:get_feed", extra.id, "call", 1.0)
    print(clean.summary())

    print("\n== Keywords vs Code KG (recall@5 / nDCG) ==")
    K, N_ANCHORS = 5, 1
    scored, results = run_retrieval_eval(clean, k=K, n_anchors=N_ANCHORS)
    print(narrate_retrieval_comparison(clean, scored, results))


if __name__ == "__main__":
    main()
