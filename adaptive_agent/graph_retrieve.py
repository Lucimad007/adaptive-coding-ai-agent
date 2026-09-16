"""L4 retrieval: audit, dedup, keyword vs anchor+PageRank."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from adaptive_agent.code_graph import CodeGraph, Edge, Node
from adaptive_agent.graph_store import pagerank


@dataclass
class Scorecard:
    n_nodes: int
    n_edges: int
    by_kind: dict[str, int]
    self_loops: int
    isolated: int
    duplicate_labels: int

    def format(self, label: str = "") -> str:
        head = f"{label}: " if label else ""
        kinds = ", ".join(f"{k}={v}" for k, v in sorted(self.by_kind.items()))
        return (
            f"{head}{self.n_nodes} nodes, {self.n_edges} edges ({kinds}); "
            f"self-loops={self.self_loops}, isolated={self.isolated}, "
            f"duplicate-labels={self.duplicate_labels}"
        )


def audit(graph: CodeGraph) -> Scorecard:
    by_kind: dict[str, int] = Counter(e.kind for e in graph.edges.values())
    self_loops = sum(1 for e in graph.edges.values() if e.source == e.target)
    touched = {e.source for e in graph.edges.values()} | {e.target for e in graph.edges.values()}
    isolated = sum(1 for nid in graph.nodes if nid not in touched)
    labels = Counter((n.kind, n.label) for n in graph.nodes.values())
    duplicate_labels = sum(1 for count in labels.values() if count > 1)
    return Scorecard(
        n_nodes=len(graph.nodes),
        n_edges=len(graph.edges),
        by_kind=dict(by_kind),
        self_loops=self_loops,
        isolated=isolated,
        duplicate_labels=duplicate_labels,
    )


def dedup(graph: CodeGraph) -> CodeGraph:
    """Drop self-loops and isolated nodes; keep one undirected co_edit pair."""
    clean = CodeGraph()
    for node in graph.nodes.values():
        clean.add_node(node)
    seen_coedit: set[tuple[str, str]] = set()
    for edge in graph.edges.values():
        if edge.source == edge.target:
            continue
        if edge.kind == "co_edit":
            pair = tuple(sorted((edge.source, edge.target)))
            if pair in seen_coedit:
                continue
            seen_coedit.add(pair)
            clean.add_edge(edge.source, edge.target, edge.kind, edge.weight)
            clean.add_edge(edge.target, edge.source, edge.kind, edge.weight)
            continue
        clean.add_edge(edge.source, edge.target, edge.kind, edge.weight)
    touched = {e.source for e in clean.edges.values()} | {e.target for e in clean.edges.values()}
    clean.nodes = {nid: node for nid, node in clean.nodes.items() if nid in touched}
    clean.edges = {
        key: edge
        for key, edge in clean.edges.items()
        if edge.source in clean.nodes and edge.target in clean.nodes
    }
    return clean


def _tokens(text: str) -> set[str]:
    return {tok for tok in re.findall(r"[a-z0-9]+", text.lower()) if len(tok) > 2}


def keyword_retrieve(graph: CodeGraph, query: str, k: int = 5) -> list[tuple[Node, float]]:
    q = _tokens(query)
    scored: list[tuple[Node, float]] = []
    for node in graph.nodes.values():
        d = _tokens(f"{node.label} {node.path} {node.id}")
        score = (len(q & d) / len(q)) if q else 0.0
        if score > 0:
            scored.append((node, score))
    scored.sort(key=lambda item: item[1], reverse=True)
    return scored[:k]


def _char_ngrams(text: str, n: int = 3) -> Counter:
    s = re.sub(r"[^a-z0-9]+", " ", text.lower())
    padded = f"  {s}  "
    return Counter(padded[i : i + n] for i in range(len(padded) - n + 1))


def _cosine(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    keys = set(a) | set(b)
    dot = sum(a[k] * b[k] for k in keys)
    na = sum(v * v for v in a.values()) ** 0.5
    nb = sum(v * v for v in b.values()) ** 0.5
    if not na or not nb:
        return 0.0
    return dot / (na * nb)


def semantic_retrieve(graph: CodeGraph, query: str, k: int = 5) -> list[tuple[Node, float]]:
    """Anchor by character-ngram similarity (stand-in for embeddings)."""
    q = _char_ngrams(query)
    scored = [(node, _cosine(q, _char_ngrams(f"{node.label} {node.path}"))) for node in graph.nodes.values()]
    scored = [(n, s) for n, s in scored if s > 0]
    scored.sort(key=lambda item: item[1], reverse=True)
    return scored[:k]


def pick_anchors(
    graph: CodeGraph,
    query: str,
    n_anchors: int = 1,
    *,
    mode: str = "keyword",
) -> list[Node]:
    hits = semantic_retrieve(graph, query, k=max(n_anchors, 3)) if mode == "sem" else keyword_retrieve(
        graph, query, k=max(n_anchors, 3)
    )
    return [node for node, _ in hits[:n_anchors]]


def graph_retrieve(
    graph: CodeGraph,
    query: str,
    *,
    k: int = 5,
    n_anchors: int = 1,
    anchor_mode: str = "keyword",
) -> dict:
    anchors = pick_anchors(graph, query, n_anchors=n_anchors, mode=anchor_mode)
    personalize = {node.id: 1.0 for node in anchors} if anchors else None
    ranks = pagerank(_walk_graph(graph), personalize=personalize)
    ranked = sorted(ranks.items(), key=lambda item: item[1], reverse=True)
    hits = [(graph.nodes[nid], score) for nid, score in ranked if nid in graph.nodes][:k]
    return {
        "query": query,
        "anchors": anchors,
        "hits": hits,
        "keyword": keyword_retrieve(graph, query, k=k),
        "sem": semantic_retrieve(graph, query, k=k),
    }


def _walk_graph(graph: CodeGraph, kinds: set[str] | None = None) -> CodeGraph:
    kinds = kinds or {"contains", "call"}
    walk = CodeGraph()
    for node in graph.nodes.values():
        walk.add_node(node)
    for edge in graph.edges.values():
        if edge.kind not in kinds:
            continue
        walk.add_edge(edge.source, edge.target, edge.kind, edge.weight)
        walk.add_edge(edge.target, edge.source, edge.kind, edge.weight)
    return walk


@dataclass
class EvalTask:
    query: str
    wanted_id: str
    kind: str
    caller_id: str | None = None


def build_eval_tasks(graph: CodeGraph, *, multi_hop: int = 6, similarity: int = 6) -> list[EvalTask]:
    return build_call_eval_tasks(graph, limit=multi_hop) + build_similarity_eval_tasks(graph, limit=similarity)


def build_call_eval_tasks(graph: CodeGraph, limit: int = 12) -> list[EvalTask]:
    """Multi-hop: query names the caller; wanted is a callee not in the query."""
    tasks: list[EvalTask] = []
    for edge in graph.edges.values():
        if edge.kind != "call":
            continue
        caller = graph.nodes.get(edge.source)
        callee = graph.nodes.get(edge.target)
        if not caller or not callee:
            continue
        caller_name = caller.label.split(".")[-1].rstrip("()")
        callee_name = callee.label.split(".")[-1].rstrip("()")
        query = f"When {caller_name} runs, which internal function does it call?"
        if callee_name.lower() in query.lower():
            continue
        tasks.append(
            EvalTask(query=query, wanted_id=callee.id, kind="multi-hop", caller_id=caller.id)
        )
        if len(tasks) >= limit:
            break
    return tasks


def build_similarity_eval_tasks(graph: CodeGraph, limit: int = 6) -> list[EvalTask]:
    """Lexical: 'Where is X defined?' — wanted is the symbol itself."""
    tasks: list[EvalTask] = []
    for node in graph.nodes.values():
        if node.kind == "file":
            continue
        name = node.label.split(".")[-1].rstrip("()")
        if len(name) < 4:
            continue
        tasks.append(
            EvalTask(
                query=f"Where is {name} defined?",
                wanted_id=node.id,
                kind="similarity",
                caller_id=node.id,
            )
        )
        if len(tasks) >= limit:
            break
    return tasks


def _rank_of(wanted_id: str, hits: list[tuple[Node, float]]) -> int | None:
    for i, (node, _) in enumerate(hits, start=1):
        if node.id == wanted_id:
            return i
    return None


def _ndcg(rank: int | None) -> float:
    if not rank:
        return 0.0
    from math import log2

    return 1.0 / log2(rank + 1)


def run_retrieval_eval(
    graph: CodeGraph,
    tasks: list[EvalTask] | None = None,
    *,
    k: int = 5,
    n_anchors: int = 1,
) -> tuple[list[dict], dict]:
    tasks = tasks or build_eval_tasks(graph)
    scored: list[dict] = []
    for task in tasks:
        kg = graph_retrieve(graph, task.query, k=k, n_anchors=n_anchors, anchor_mode="keyword")
        sem = graph_retrieve(graph, task.query, k=k, n_anchors=n_anchors, anchor_mode="sem")
        kg_rank = _rank_of(task.wanted_id, kg["hits"])
        sem_rank = _rank_of(task.wanted_id, sem["hits"])
        kw_rank = _rank_of(task.wanted_id, kg["keyword"])
        scored.append(
            {
                "task": task,
                "anchors": [a.id for a in kg["anchors"]],
                "sem_anchors": [a.id for a in sem["anchors"]],
                "kg": [n.id for n, _ in kg["hits"]],
                "kw": [n.id for n, _ in kg["keyword"]],
                "sem": [n.id for n, _ in sem["hits"]],
                "kg_recall": 1.0 if kg_rank else 0.0,
                "kw_recall": 1.0 if kw_rank else 0.0,
                "sem_recall": 1.0 if sem_rank else 0.0,
                "kg_ndcg": _ndcg(kg_rank),
                "kw_ndcg": _ndcg(kw_rank),
                "sem_ndcg": _ndcg(sem_rank),
                "kw_top": kg["keyword"][0][0].id if kg["keyword"] else "",
            }
        )
    n = len(scored) or 1
    summary = {
        "n": len(scored),
        "k": k,
        "keywords_recall": sum(row["kw_recall"] for row in scored) / n,
        "code_kg_recall": sum(row["kg_recall"] for row in scored) / n,
        "code_kg_sem_recall": sum(row["sem_recall"] for row in scored) / n,
        "keywords_ndcg": sum(row["kw_ndcg"] for row in scored) / n,
        "code_kg_ndcg": sum(row["kg_ndcg"] for row in scored) / n,
        "code_kg_sem_ndcg": sum(row["sem_ndcg"] for row in scored) / n,
    }
    return scored, summary


def _mark(found: bool) -> str:
    return "found" if found else "missed"


def narrate_retrieval_comparison(
    graph: CodeGraph,
    scored: list[dict],
    summary: dict,
    *,
    examples: int = 6,
) -> str:
    k = summary["k"]
    lines = [
        "Glossary:",
        f"  recall@{k} = was the wanted node in the top {k}?  (1.0 = yes, 0.0 = no)",
        "  nDCG     = if found, how high did it rank?     (1.0 = rank 1, lower = deeper)",
        "  keywords = plain keyword search (soft word match), no graph",
        "  code KG  = keyword ANCHOR, then Personalized PageRank on contains/call edges",
        "  code KG (sem) = same walk, but the anchor is picked by n-gram similarity",
        "  wanted   = ground truth from the graph edge or symbol that built the task",
        "",
        "Legend: found = wanted node in top k    missed = not in top k",
        "",
    ]
    by_kind: dict[str, int] = {}
    shown = 0
    for row in scored:
        if shown >= examples:
            break
        task: EvalTask = row["task"]
        kind = task.kind
        by_kind[kind] = by_kind.get(kind, 0) + 1
        if by_kind[kind] > 3:
            continue
        wanted = graph.nodes[task.wanted_id]
        shown += 1
        lines += [
            f"Example #{shown} - [{kind} test]",
            f"  query         : {task.query}",
            f"  wanted        : {wanted.id}",
            f"  keywords      : {_mark(bool(row['kw_recall']))}  top1={row['kw_top'] or '-'}",
            f"  code KG       : {_mark(bool(row['kg_recall']))}  (recall@{k}={row['kg_recall']:.0f})",
            f"  code KG (sem) : {_mark(bool(row['sem_recall']))}  (recall@{k}={row['sem_recall']:.0f})",
            "",
        ]
    lines += [
        "Scorecard (every task):",
        f"  n={summary['n']}",
        f"  keywords       recall@{k}={summary['keywords_recall']:.2f}  nDCG={summary['keywords_ndcg']:.2f}",
        f"  code KG        recall@{k}={summary['code_kg_recall']:.2f}  nDCG={summary['code_kg_ndcg']:.2f}",
        f"  code KG (sem)  recall@{k}={summary['code_kg_sem_recall']:.2f}  nDCG={summary['code_kg_sem_ndcg']:.2f}",
    ]
    return "\n".join(lines)


def starter_code_graph() -> CodeGraph:
    """Hand-built L4 starter graph (retriever / auth toy)."""
    graph = CodeGraph()
    specs = [
        ("file:retriever.py", "file", "retriever.py", "retriever.py"),
        ("file:graph_store.py", "file", "graph_store.py", "graph_store.py"),
        ("file:auth.py", "file", "auth.py", "auth.py"),
        ("file:api.py", "file", "api.py", "api.py"),
        ("file:test_retriever.py", "file", "test_retriever.py", "test_retriever.py"),
        ("fn:seed_ppr", "function", "seed_ppr()", "retriever.py"),
        ("fn:walk_edges", "function", "walk_edges()", "retriever.py"),
        ("fn:verify_token", "function", "verify_token()", "retriever.py"),
    ]
    for nid, kind, label, path in specs:
        graph.add_node(Node(id=nid, kind=kind, label=label, path=path))
    for src, dst, kind in [
        ("file:retriever.py", "fn:seed_ppr", "contains"),
        ("file:retriever.py", "fn:walk_edges", "contains"),
        ("file:retriever.py", "fn:verify_token", "contains"),
        ("file:retriever.py", "file:graph_store.py", "import"),
        ("file:api.py", "file:auth.py", "import"),
        ("file:api.py", "file:retriever.py", "import"),
        ("fn:seed_ppr", "fn:walk_edges", "call"),
        ("fn:verify_token", "fn:seed_ppr", "call"),
        ("file:retriever.py", "file:graph_store.py", "co_edit"),
        ("file:retriever.py", "file:test_retriever.py", "co_edit"),
        ("file:graph_store.py", "file:test_retriever.py", "co_edit"),
        ("file:api.py", "file:auth.py", "co_edit"),
    ]:
        graph.add_edge(src, dst, kind, 1.0)
        if kind == "co_edit":
            graph.add_edge(dst, src, kind, 1.0)
    return graph


def render_anchor_walk(
    graph: CodeGraph,
    query: str,
    *,
    k: int = 4,
    n_anchors: int = 1,
) -> str:
    """Word-match an anchor, then walk edges (personalized PageRank)."""
    result = graph_retrieve(graph, query, k=k, n_anchors=n_anchors)
    anchors = result["anchors"]
    walk_ids = [node.id for node, _ in result["hits"]]
    walk_labels = [graph.nodes[nid].label for nid in walk_ids if nid in graph.nodes]
    anchor = anchors[0] if anchors else None
    matched = sorted(_tokens(query) & _tokens(anchor.label if anchor else ""))

    lines = [
        f'The anchor for the query: "{query}"',
        "word match finds the anchor; the graph walk reaches the rest",
        "",
        f'Query  : "{query}"',
        f"Anchor : {anchor.label if anchor else '(none)'}  <- best word match ({', '.join(matched) or 'none'})",
        f"Walk   : {', '.join(walk_labels)}",
        "None of the non-anchor hits need to share words with the query; edges carry the walk.",
        "",
        _mermaid(graph, walk_ids, anchor.id if anchor else None),
    ]
    return "\n".join(lines)


def _mermaid_id(node_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "_", node_id)


def _mermaid(graph: CodeGraph, walk_ids: list[str], anchor_id: str | None) -> str:
    walk = set(walk_ids)
    out = ["```mermaid", "flowchart LR"]
    for node in graph.nodes.values():
        shape = f'["{node.label}"]' if node.kind == "file" else f'(["{node.label}"])'
        out.append(f"  {_mermaid_id(node.id)}{shape}")
    drawn_coedit: set[tuple[str, str]] = set()
    for edge in graph.edges.values():
        a, b = _mermaid_id(edge.source), _mermaid_id(edge.target)
        if edge.kind == "co_edit":
            pair = tuple(sorted((a, b)))
            if pair in drawn_coedit:
                continue
            drawn_coedit.add(pair)
            out.append(f"  {a} -.->|co_edit| {b}")
        elif edge.kind == "call":
            out.append(f"  {a} -.->|call| {b}")
        elif edge.kind == "import":
            out.append(f"  {a} -->|import| {b}")
        elif edge.kind == "contains":
            out.append(f"  {a} -->|contains| {b}")
    if walk:
        out.append("  classDef reached stroke-width:3px")
        out.append("  class " + ",".join(_mermaid_id(i) for i in walk) + " reached")
    if anchor_id:
        out.append("  classDef anchor stroke-width:4px")
        out.append(f"  class {_mermaid_id(anchor_id)} anchor")
    out.append("```")
    return "\n".join(out)


def match_edges(graph: CodeGraph, *, kind: str | None = None, node_id: str | None = None) -> list[Edge]:
    rows = list(graph.edges.values())
    if kind:
        rows = [e for e in rows if e.kind == kind]
    if node_id:
        rows = [e for e in rows if e.source == node_id or e.target == node_id]
    return rows
