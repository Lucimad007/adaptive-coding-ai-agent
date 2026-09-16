from adaptive_agent.coding_eval import TASKS, hits_ok, score_task, snapshot


def test_hits_ok_matches_substring():
    assert hits_ok(["fn:feed/player.py:autoplay"], ["autoplay", "player"])
    assert not hits_ok(["fn:other"], ["autoplay"])


def test_score_task_offline_retrieval(tmp_path, sample_repo):
    before = snapshot(sample_repo)
    task = TASKS[0]
    score = score_task(task, workspace=sample_repo, worker=None, before=before, after=before)
    assert score.retrieval_ok
    assert score.passed


def test_score_task_requires_expected_files(tmp_path):
    task = TASKS[0]
    before = {"feed/player.py": "x", "tests/test_feed.py": "y", "app.py": "z"}
    after = {
        "feed/player.py": "def clip_count(clips):\n    return len(clips)\n",
        "tests/test_feed.py": "from feed.player import clip_count\n",
        "app.py": "z",
    }
    dest = tmp_path / "ws"
    dest.mkdir()
    (dest / "tests").mkdir()
    (dest / "feed").mkdir()
    for rel, text in after.items():
        (dest / rel).write_text(text, encoding="utf-8")
    worker = {"ok": True, "tools": ["search_graph", "apply_patch"], "walkIds": ["fn:feed/player.py:autoplay"], "hits": []}
    score = score_task(task, workspace=dest, worker=worker, before=before, after=after)
    assert score.files_ok
    assert score.content_ok
    assert score.retrieval_ok
