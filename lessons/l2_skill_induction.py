"""L2 analog: traces -> skill induction -> human review -> Skill Box -> better agent."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from adaptive_agent.agent import reset_demo_env, run_task
from adaptive_agent.induction import resume_induction, start_induction
from adaptive_agent.memory import Memory
from adaptive_agent.review import print_diff
from adaptive_agent.skills import SkillBox

def _out(text: object) -> None:
    s = str(text)
    try:
        print(s)
    except UnicodeEncodeError:
        print(s.encode("ascii", "replace").decode("ascii"))


PAYOFF_TASK = "Run the test suite for this project."
TOPIC = "run_test_suite"
DB_PATH = ROOT / "data" / "l2.db"


def seed_failure_traces(mem: Memory) -> None:
    mem.add_episode(
        topic=TOPIC,
        task=PAYOFF_TASK,
        outcome="failure",
        error="ModuleNotFoundError: pytest is not installed",
        fix=None,
        tool_calls=[{"name": "run_tests", "args": {"install_deps": False}}],
    )
    mem.add_episode(
        topic=TOPIC,
        task=PAYOFF_TASK,
        outcome="failure",
        error="ModuleNotFoundError: pytest is not installed",
        fix=None,
        tool_calls=[{"name": "run_tests", "args": {"install_deps": False}}],
    )
    mem.add_episode(
        topic=TOPIC,
        task=PAYOFF_TASK,
        outcome="success",
        error="ModuleNotFoundError: pytest is not installed",
        fix="Call run_tests with install_deps=true, then tests pass",
        tool_calls=[{"name": "run_tests", "args": {"install_deps": True}}],
    )


def print_seed_summary(mem: Memory, box: SkillBox) -> None:
    episodes = mem.all_episodes()
    print(f"Seeded {len(episodes)} episodes")
    by_topic: dict[str, int] = {}
    for ep in episodes:
        by_topic[ep.topic] = by_topic.get(ep.topic, 0) + 1
    for topic, count in by_topic.items():
        print(f"  {topic}: {count}")
    print("Skill Box:")
    for skill in box.all_skills():
        print(f"  {skill.heading}")


def main() -> None:
    parser = argparse.ArgumentParser(description="L2 skill induction walkthrough")
    parser.add_argument(
        "--decision",
        choices=("approve", "reject"),
        default="approve",
        help="Human review decision for the induced skill",
    )
    parser.add_argument(
        "--reason",
        default="v2 installs deps before tests, matching the repeated fix in traces",
    )
    args = parser.parse_args()

    if DB_PATH.exists():
        DB_PATH.unlink()

    db = str(DB_PATH)
    mem = Memory(db)
    box = SkillBox(db)
    box.seed_from_files()

    print("== Before skill induction ==")
    reset_demo_env()
    before = run_task(PAYOFF_TASK, box, mem=mem, topic=TOPIC)
    print(f"Retrieved: {before['skill'].heading if before['skill'] else 'none'}")
    _out(before["final"])
    print(f"Outcome: {before['outcome']}")

    print("\n== Loading traces ==")
    seed_failure_traces(mem)
    print_seed_summary(mem, box)

    print("\n== Skill Box search ==")
    hit = box.search(PAYOFF_TASK, k=1)[0]
    print(f"Top hit: {hit[0].heading} score={hit[1]:.2f}")

    print("\n== Skill induction engine ==")
    current = box.active_skill("run-the-tests")
    episodes = mem.episodes_for_topic(TOPIC)
    app, config, paused = start_induction(
        topic=TOPIC,
        episodes=episodes,
        current=current,
        db_path=db,
    )
    interrupts = paused.get("__interrupt__") if isinstance(paused, dict) else None
    proposal = None
    if interrupts:
        proposal = interrupts[0].value["proposal"]
    elif isinstance(paused, dict) and paused.get("proposal"):
        proposal = paused["proposal"]
    if not proposal:
        snapshot = app.get_state(config)
        tasks = snapshot.tasks
        if tasks and getattr(tasks[0], "interrupts", None):
            proposal = tasks[0].interrupts[0].value["proposal"]
        elif snapshot.values.get("proposal"):
            proposal = snapshot.values["proposal"]
    if not proposal:
        raise SystemExit(f"Induction did not produce a proposal: {paused!r}")

    print_diff(current, proposal)
    pending = box.pending()
    print(f"awaiting review: {pending[0].name} v{pending[0].version}" if pending else "no pending")

    print("\n== Human in the loop ==")
    print(f"Decision: {args.decision} | Reason: {args.reason}")
    done = resume_induction(app, config, decision=args.decision, reason=args.reason)
    applied = done.get("applied") if isinstance(done, dict) else None
    print(f"Applied: {applied}")

    print("\n== Skill Box after review ==")
    for skill in box.all_skills():
        print(f"  {skill.heading}")
    after_hit = box.search(PAYOFF_TASK, k=1)[0]
    print(f"Same task now retrieves: {after_hit[0].heading} score={after_hit[1]:.2f}")

    print("\n== Agent with enhanced skill ==")
    reset_demo_env()
    after = run_task(PAYOFF_TASK, box, mem=mem, topic=TOPIC)
    print(f"Retrieved: {after['skill'].heading if after['skill'] else 'none'}")
    _out(after["final"])
    print(f"Outcome: {after['outcome']}")


if __name__ == "__main__":
    main()
