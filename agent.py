"""Simple LangChain tool-calling smoke test on OpenCode Go + DeepSeek V4.1 Flash."""

from __future__ import annotations

from datetime import datetime, timezone

from langchain.agents import create_agent
from langchain_core.tools import tool

from adaptive_agent.llm import build_llm


@tool
def get_current_time() -> str:
    """Return the current UTC time in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat()


@tool
def add_numbers(a: float, b: float) -> float:
    """Add two numbers and return the sum."""
    return a + b


def build_agent():
    return create_agent(
        model=build_llm(),
        tools=[get_current_time, add_numbers],
        system_prompt=(
            "You are a concise assistant. Use tools when they help. "
            "You run on DeepSeek V4.1 Flash via OpenCode Go."
        ),
    )


def main() -> None:
    agent = build_agent()
    prompt = "What time is it in UTC, and what is 41 + 1?"
    result = agent.invoke({"messages": [{"role": "user", "content": prompt}]})
    messages = result["messages"]
    print(messages[-1].content)


if __name__ == "__main__":
    main()
