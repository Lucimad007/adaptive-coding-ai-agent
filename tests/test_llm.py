import os

from adaptive_agent.llm import vision_chat_model


def test_vision_off_for_text_model(monkeypatch):
    monkeypatch.delenv("OPENCODE_VISION_MODEL", raising=False)
    monkeypatch.setenv("OPENCODE_MODEL", "deepseek-flash")
    assert vision_chat_model() is None


def test_vision_on_for_vision_model(monkeypatch):
    monkeypatch.delenv("OPENCODE_VISION_MODEL", raising=False)
    monkeypatch.setenv("OPENCODE_MODEL", "deepseek-v4-flash-vision-exp")
    assert vision_chat_model() == "deepseek-v4-flash-vision-exp"


def test_vision_override(monkeypatch):
    monkeypatch.setenv("OPENCODE_MODEL", "deepseek-flash")
    monkeypatch.setenv("OPENCODE_VISION_MODEL", "deepseek-v4-flash-vision-exp")
    assert vision_chat_model() == "deepseek-v4-flash-vision-exp"
