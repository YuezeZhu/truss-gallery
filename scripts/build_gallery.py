"""Copy the canonical skeleton and property dataset into the static Gallery."""

from __future__ import annotations

import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "truss32_minimal" / "dataset.json"
TARGET = ROOT / "truss-gallery" / "dist" / "data" / "samples.json"


def main() -> None:
    dataset = json.loads(SOURCE.read_text(encoding="utf-8"))
    if dataset["schema"] != "truss32-minimal-v1":
        raise ValueError("Unexpected compact dataset schema")
    if len(dataset["samples"]) != 303:
        raise ValueError("Expected 303 accepted samples")
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE, TARGET)
    print(f"Copied {len(dataset['samples'])} skeleton records to {TARGET}")


if __name__ == "__main__":
    main()
