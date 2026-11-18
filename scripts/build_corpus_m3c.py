"""Write the grounded-testing scenario set and its manifest to a directory (Milestone 3c).

uv run --package ai-workforce-api python scripts/build_corpus_m3c.py docs/review/m3c/corpus
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "api" / "tests"))

from corpus_m3c import build  # noqa: E402
from corpus_m3c_supplement import build as build_supplement  # noqa: E402


def main() -> None:
    """`--supplement` writes the supplementary scenarios (corpus_m3c_supplement.py)."""
    args = [arg for arg in sys.argv[1:] if arg != "--supplement"]
    target = Path(args[0] if args else "corpus-m3c-out")
    manifest = (build_supplement if "--supplement" in sys.argv else build)(target)
    files = sum(len(s.files) for c in manifest.controls for s in c.samples) + len(manifest.controls)
    cells = len(manifest.cells())
    print(f"wrote {files} files for {len(manifest.controls)} controls ({cells} cells) to {target}")


if __name__ == "__main__":
    main()
