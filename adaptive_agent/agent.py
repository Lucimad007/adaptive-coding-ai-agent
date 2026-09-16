"""LangChain agent that retrieves an active skill and uses demo tools."""

from __future__ import annotations

from langchain.agents import create_agent
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

from adaptive_agent.llm import build_llm
from adaptive_agent.memory import Memory
from adaptive_agent.router import route_task
from adaptive_agent.skills import SkillBox

_DEPS_INSTALLED = False


def reset_demo_env() -> None:
    global _DEPS_INSTALLED
    _DEPS_INSTALLED = False


@tool
def run_tests(install_deps: bool = False) -> str:
    """Run the project test suite.

    Set install_deps=True to install dependencies before running tests.
    """
    global _DEPS_INSTALLED
    if install_deps:
        _DEPS_INSTALLED = True
    if not _DEPS_INSTALLED:
        return (
            "ERROR: ModuleNotFoundError: pytest is not installed. "
            "Install dependencies, then re-run the tests."
        )
    return "OK: 12 passed"


def build_skill_agent(skill_text: str | None = None, *, task: str = ""):
    skill_block = skill_text or "No skill retrieved. Use tools as needed."
    chosen = route_task(task or "code")
    return create_agent(
        model=build_llm(model=chosen.model, temperature=chosen.adapter.temperature),
        tools=[run_tests],
        system_prompt=(
            f"{chosen.system_prompt}\n\n"
            "Follow the retrieved skill exactly.\n\n"
            f"## Retrieved skill\n{skill_block}"
        ),
    )


def run_task(task: str, box: SkillBox, mem: Memory | None = None, topic: str = "run_test_suite") -> dict:
    hits = box.search(task, k=1)
    skill = hits[0][0] if hits else None
    skill_text = skill.body if skill else None
    agent = build_skill_agent(skill_text, task=task)
    result = agent.invoke({"messages": [HumanMessage(content=task)]})
    messages = result["messages"]
    final = messages[-1].content
    tool_calls = []
    failed = "ERROR:" in str(final) or "ModuleNotFoundError" in str(final)
    for msg in messages:
        extra = getattr(msg, "tool_calls", None) or []
        for call in extra:
            tool_calls.append(
                {
                    "name": call.get("name"),
                    "args": call.get("args"),
                }
            )
            args = call.get("args") or {}
            if call.get("name") == "run_tests" and not args.get("install_deps"):
                failed = True
            if call.get("name") == "run_tests" and args.get("install_deps"):
                failed = False

    outcome = "failure" if failed and "OK:" not in str(final) else (
        "success" if "OK:" in str(final) else ("failure" if failed else "success")
    )
    if mem is not None:
        mem.add_episode(
            topic=topic,
            task=task,
            outcome=outcome,
            error="pytest not installed" if outcome == "failure" else None,
            fix="run_tests(install_deps=true)" if outcome == "success" else None,
            tool_calls=tool_calls,
        )
    return {
        "skill": skill,
        "final": final,
        "outcome": outcome,
        "tool_calls": tool_calls,
        "messages": messages,
    }
