"""OpenCode Go ChatOpenAI client."""

from __future__ import annotations

import os
import uuid

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

OPENCODE_BASE_URL = os.getenv("OPENCODE_BASE_URL", "https://opencode.ai/zen/go/v1")
OPENCODE_MODEL = os.getenv("OPENCODE_MODEL", "deepseek-flash")

# OpenCode Go /chat/completions models that actually take image parts.
VISION_MODELS = frozenset({"deepseek-v4-flash-vision-exp"})


def vision_chat_model() -> str | None:
    """Model that can see images, or None if this install cannot accept pastes."""
    explicit = (os.getenv("OPENCODE_VISION_MODEL") or "").strip()
    if explicit:
        return explicit
    model = (os.getenv("OPENCODE_MODEL") or OPENCODE_MODEL or "").strip()
    if model in VISION_MODELS:
        return model
    return None


def build_llm(*, temperature: float = 0.2, model: str | None = None) -> ChatOpenAI:
    api_key = os.getenv("OPENCODE_API_KEY")
    if not api_key:
        raise SystemExit(
            "Missing OPENCODE_API_KEY. Copy .env.example to .env and paste your OpenCode Go key."
        )

    session_id = os.getenv("OPENCODE_SESSION") or str(uuid.uuid4())
    return ChatOpenAI(
        model=model or OPENCODE_MODEL,
        api_key=api_key,
        base_url=OPENCODE_BASE_URL,
        temperature=temperature,
        default_headers={
            "x-opencode-session": session_id,
            "User-Agent": "adaptive-ai-agent/1.0",
        },
    )
