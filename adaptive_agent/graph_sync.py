"""Close the adaptation loop: new commits -> extract -> MERGE -> re-rank."""

from __future__ import annotations

import argparse
import time
from pathlib import Path

from adaptive_agent.code_graph import build_code_graph, git_head
from adaptive_agent.graph_store import GraphDB, pagerank


def sync_once(repo: Path, db: GraphDB) -> str:
    repo = repo.resolve()
    head = git_head(repo) or "NOGIT"
    last = db.last_commit(str(repo))
    if last == head:
        return f"up to date at {head[:8]}"

    since = last if last and last != "NOGIT" else None
    graph = build_code_graph(repo, since_commit=since)
    append = {"coedit"} if last else set()
    db.merge(str(repo), graph, append_kinds=append)
    stored = db.load_graph(str(repo))
    ranks = pagerank(stored)
    db.save_ranks(str(repo), ranks)
    db.set_last_commit(str(repo), head)

    top = sorted(ranks.items(), key=lambda item: item[1], reverse=True)[:8]
    lines = [
        f"cycle: extract -> MERGE -> re-rank",
        f"repo: {repo}",
        f"commits: {last or '(none)'} -> {head}",
        stored.summary(),
        "top ranks:",
    ]
    for node_id, score in top:
        lines.append(f"  {score:.4f}  {node_id}")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Keep a code knowledge graph current: extract, merge, re-rank."
    )
    parser.add_argument("--repo", required=True, help="Target codebase to keep in sync")
    parser.add_argument("--db", default="", help="SQLite path (default data/code_graph.db)")
    parser.add_argument(
        "--interval",
        type=int,
        default=0,
        help="Seconds between cycles. 0 runs once.",
    )
    args = parser.parse_args()
    repo = Path(args.repo).expanduser().resolve()
    db = GraphDB(args.db) if args.db else GraphDB()

    while True:
        print(sync_once(repo, db), flush=True)
        if args.interval <= 0:
            break
        print(f"sleeping {args.interval}s until next cycle", flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
