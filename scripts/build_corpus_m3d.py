"""Write the M3d scenario sets and their manifests to a directory (Milestone 3d).

    uv run --package ai-workforce-api python scripts/build_corpus_m3d.py docs/review/m3d

Writes `corpus-hostile/` (corpus_m3d_hostile.py), `corpus-consistency/` (the first
evidence-requirement set, corpus_m3d_consistency.py), `corpus-consistency-v2/` (the
corrected set, corpus_m3d_consistency_v2.py) and `corpus-hostile-v2/` (the closure's unseen
attacks, corpus_m3d_hostile_v2.py), each with its manifest.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "api" / "tests"))

from corpus_m3d_consistency import build as build_consistency  # noqa: E402
from corpus_m3d_consistency_v2 import build as build_consistency_v2  # noqa: E402
from corpus_m3d_hostile import build as build_hostile  # noqa: E402
from corpus_m3d_hostile_v2 import build as build_hostile_v2  # noqa: E402


def main() -> None:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "corpus-m3d-out")
    hostile = build_hostile(target / "corpus-hostile")
    consistency = build_consistency(target / "corpus-consistency")
    build_consistency_v2(target / "corpus-consistency-v2")
    unseen = build_hostile_v2(target / "corpus-hostile-v2")
    print(
        f"wrote {len(hostile.control.samples)} hostile samples ({len(hostile.attacks)} attacks)"
        f", {len(consistency.cells())} consistency cells and {len(unseen.attacks)} unseen "
        f"attacks to {target}"
    )


if __name__ == "__main__":
    main()
