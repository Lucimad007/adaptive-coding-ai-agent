from adaptive_agent.memory import Memory


def test_add_and_list_episodes(tmp_db):
    mem = Memory(tmp_db)
    eid = mem.add_episode(
        topic="run_test_suite",
        task="run tests",
        outcome="failure",
        error="pytest missing",
        fix=None,
        tool_calls=[{"name": "run_tests"}],
    )
    assert eid >= 1
    rows = mem.episodes_for_topic("run_test_suite")
    assert len(rows) == 1
    assert rows[0].outcome == "failure"
    assert rows[0].tool_calls[0]["name"] == "run_tests"
