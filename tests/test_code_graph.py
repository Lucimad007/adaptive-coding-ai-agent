from adaptive_agent.code_graph import build_code_graph
from adaptive_agent.graph_retrieve import (
    build_eval_tasks,
    graph_retrieve,
    run_retrieval_eval,
    starter_code_graph,
)
from adaptive_agent.graph_store import GraphDB, pagerank
from adaptive_agent.graph_sync import sync_once


def test_sample_graph_has_import_and_call(sample_repo):
    graph = build_code_graph(sample_repo)
    kinds = {e.kind for e in graph.edges.values()}
    assert "import" in kinds
    assert "call" in kinds
    assert any(e.target.endswith("autoplay") or "autoplay" in e.target for e in graph.edges.values() if e.kind == "call")
    summary = graph.remembered_summary(sample_repo.name)
    assert "files" in summary
    assert "symbols" in summary


def test_anchor_walk_verify_token():
    graph = starter_code_graph()
    result = graph_retrieve(graph, "where do we verify a token?", k=4)
    assert result["anchors"][0].id == "fn:verify_token"
    walk = {n.id for n, _ in result["hits"]}
    assert "fn:seed_ppr" in walk
    assert "fn:walk_edges" in walk


def test_retrieval_eval_scorecard(sample_repo):
    graph = build_code_graph(sample_repo)
    tasks = build_eval_tasks(graph, multi_hop=4, similarity=3)
    assert any(t.kind == "multi-hop" for t in tasks)
    assert any(t.kind == "similarity" for t in tasks)
    scored, summary = run_retrieval_eval(graph, tasks, k=5)
    assert summary["n"] == len(tasks)
    assert 0 <= summary["code_kg_recall"] <= 1
    assert 0 <= summary["keywords_recall"] <= 1
    assert 0 <= summary["code_kg_sem_recall"] <= 1
    assert scored[0]["kg_recall"] in {0.0, 1.0}


def test_graph_db_merge_and_pagerank(tmp_db, sample_repo):
    db = GraphDB(tmp_db)
    msg = sync_once(sample_repo, db)
    assert "cycle" in msg or "up to date" in msg
    stored = db.load_graph(str(sample_repo.resolve()))
    ranks = pagerank(stored)
    assert ranks
    assert abs(sum(ranks.values()) - 1.0) < 0.05
