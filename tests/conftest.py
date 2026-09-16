from pathlib import Path

import pytest

from adaptive_agent.memory import ROOT


@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def sample_repo() -> Path:
    return ROOT / "fixtures" / "sample_codebase"
