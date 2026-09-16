from adaptive_agent.plan_gate import GATE_PATH, read_gate, wait_for_answers, write_gate


def test_plan_gate_answer_unblocks(tmp_path, monkeypatch):
    gate = tmp_path / "plan_gate.json"
    monkeypatch.setattr("adaptive_agent.plan_gate.GATE_PATH", gate)
    write_gate({"id": "abc", "status": "answered", "answers": {"1": "yes"}})
    assert wait_for_answers("abc", timeout=1, interval=0.01) == {"1": "yes"}
    assert read_gate()["id"] == "abc"
