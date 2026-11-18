"""Write the synthetic evidence corpus and its manifest to a directory (Milestone 3b).

    uv run --package ai-workforce-api python scripts/build_corpus.py docs/review/m3b/corpus
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "api" / "tests"))

from corpus import build  # noqa: E402


def main() -> None:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "corpus-out")
    manifest = build(target)
    files = sum(len(scenario.files) for scenario in manifest.scenarios)
    print(f"wrote {files} files in {len(manifest.scenarios)} scenarios to {target}")


if __name__ == "__main__":
    main()
