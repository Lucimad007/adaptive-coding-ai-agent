from adaptive_agent.review import apply_decision
from adaptive_agent.skills import Skill, SkillBox


def test_seed_and_search(tmp_db):
    box = SkillBox(tmp_db)
    box.seed_from_files()
    hit = box.search("run the test suite", k=1)[0]
    assert hit[0].name == "run-the-tests"
    assert hit[0].status == "active"


def test_approve_supersedes_v1(tmp_db):
    box = SkillBox(tmp_db)
    box.upsert(Skill(name="run-the-tests", version=1, status="active", body="v1"))
    v2 = Skill(name="run-the-tests", version=2, status="pending", body="install then test")
    box.upsert(v2)
    apply_decision(box, v2, approve=True, reason="matches traces")
    assert box.active_skill("run-the-tests").version == 2
    assert box.get("run-the-tests", 1).status == "superseded"
