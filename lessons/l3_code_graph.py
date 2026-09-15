"""Print and save the repo code graph (imports, calls, co-edits)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from adaptive_agent.code_graph import main

if __name__ == "__main__":
    main()
