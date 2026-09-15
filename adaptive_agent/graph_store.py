"""SQLite store for a code knowledge graph: MERGE nodes/edges, then re-rank."""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from pathlib import Path

from adaptive_agent.code_graph import CodeGraph, Edge, Node
from adaptive_agent.memory import ROOT

DEFAULT_GRAPH_DB = ROOT / "data" / "code_graph.db"


class GraphDB:
    def __init__(self, db_path: Path | str = DEFAULT_GRAPH_DB) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS repos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path TEXT NOT NULL UNIQUE,
                    last_commit TEXT,
                    updated_at TEXT
                );
                CREATE TABLE IF NOT EXISTS nodes (
                    repo_id INTEGER NOT NULL,
                    id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    label TEXT NOT NULL,
                    path TEXT NOT NULL,
                    PRIMARY KEY (repo_id, id)
                );
                CREATE TABLE IF NOT EXISTS edges (
                    repo_id INTEGER NOT NULL,
                    source TEXT NOT NULL,
                    target TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    weight REAL NOT NULL,
                    PRIMARY KEY (repo_id, source, target, kind)
                );
                CREATE TABLE IF NOT EXISTS ranks (
                    repo_id INTEGER NOT NULL,
                    node_id TEXT NOT NULL,
                    score REAL NOT NULL,
                    PRIMARY KEY (repo_id, node_id)
                );
                """
            )

    def repo_id(self, path: str) -> int:
        path = str(Path(path).resolve())
        with self.connect() as conn:
            row = conn.execute("SELECT id FROM repos WHERE path = ?", (path,)).fetchone()
            if row:
                return int(row["id"])
            cur = conn.execute("INSERT INTO repos (path) VALUES (?)", (path,))
            return int(cur.lastrowid)

    def last_commit(self, path: str) -> str | None:
        rid = self.repo_id(path)
        with self.connect() as conn:
            row = conn.execute(
                "SELECT last_commit FROM repos WHERE id = ?", (rid,)
            ).fetchone()
        return row["last_commit"] if row else None

    def set_last_commit(self, path: str, sha: str | None) -> None:
        rid = self.repo_id(path)
        with self.connect() as conn:
            conn.execute(
                "UPDATE repos SET last_commit = ?, updated_at = datetime('now') WHERE id = ?",
                (sha, rid),
            )

    def merge(self, path: str, graph: CodeGraph, *, append_kinds: set[str] | None = None) -> None:
        append_kinds = append_kinds or set()
        rid = self.repo_id(path)
        replace_kinds = {e.kind for e in graph.edges.values()} - append_kinds
        with self.connect() as conn:
            for node in graph.nodes.values():
                conn.execute(
                    """
                    INSERT INTO nodes (repo_id, id, kind, label, path)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(repo_id, id) DO UPDATE SET
                        kind = excluded.kind,
                        label = excluded.label,
                        path = excluded.path
                    """,
                    (rid, node.id, node.kind, node.label, node.path),
                )
            for kind in replace_kinds:
                conn.execute(
                    "DELETE FROM edges WHERE repo_id = ? AND kind = ?",
                    (rid, kind),
                )
            for edge in graph.edges.values():
                if edge.kind in append_kinds:
                    conn.execute(
                        """
                        INSERT INTO edges (repo_id, source, target, kind, weight)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(repo_id, source, target, kind) DO UPDATE SET
                            weight = weight + excluded.weight
                        """,
                        (rid, edge.source, edge.target, edge.kind, edge.weight),
                    )
                else:
                    conn.execute(
                        """
                        INSERT INTO edges (repo_id, source, target, kind, weight)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (rid, edge.source, edge.target, edge.kind, edge.weight),
                    )

    def load_graph(self, path: str) -> CodeGraph:
        rid = self.repo_id(path)
        graph = CodeGraph()
        with self.connect() as conn:
            for row in conn.execute("SELECT * FROM nodes WHERE repo_id = ?", (rid,)):
                graph.add_node(
                    Node(
                        id=row["id"],
                        kind=row["kind"],
                        label=row["label"],
                        path=row["path"],
                    )
                )
            for row in conn.execute("SELECT * FROM edges WHERE repo_id = ?", (rid,)):
                graph.add_edge(row["source"], row["target"], row["kind"], row["weight"])
        return graph

    def save_ranks(self, path: str, ranks: dict[str, float]) -> None:
        rid = self.repo_id(path)
        with self.connect() as conn:
            conn.execute("DELETE FROM ranks WHERE repo_id = ?", (rid,))
            conn.executemany(
                "INSERT INTO ranks (repo_id, node_id, score) VALUES (?, ?, ?)",
                [(rid, node_id, score) for node_id, score in ranks.items()],
            )

    def top_ranks(self, path: str, limit: int = 10) -> list[tuple[str, float]]:
        rid = self.repo_id(path)
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT node_id, score FROM ranks
                WHERE repo_id = ?
                ORDER BY score DESC
                LIMIT ?
                """,
                (rid, limit),
            ).fetchall()
        return [(row["node_id"], row["score"]) for row in rows]


def pagerank(
    graph: CodeGraph,
    *,
    damping: float = 0.85,
    iterations: int = 30,
) -> dict[str, float]:
    nodes = list(graph.nodes)
    if not nodes:
        return {}
    n = len(nodes)
    index = {node_id: i for i, node_id in enumerate(nodes)}
    outbound: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for edge in graph.edges.values():
        outbound[edge.source].append((edge.target, edge.weight))

    rank = [1.0 / n] * n
    for _ in range(iterations):
        nxt = [(1.0 - damping) / n] * n
        for src, targets in outbound.items():
            total = sum(w for _, w in targets) or 1.0
            i = index[src]
            share = damping * rank[i]
            for dst, weight in targets:
                nxt[index[dst]] += share * (weight / total)
        dangling = [node_id for node_id in nodes if node_id not in outbound]
        extra = damping * sum(rank[index[d]] for d in dangling) / n
        rank = [v + extra for v in nxt]
    return {node_id: rank[index[node_id]] for node_id in nodes}
