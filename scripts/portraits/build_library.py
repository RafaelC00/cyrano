"""
Turn one generation folder into the committed portrait library.

Reads every `lib_NNN.png` from data/portraits/generations/<stamp>/, writes a 640px-wide JPEG per
portrait to data/portraits/library/, and a manifest recording which generation each came from
and the spec it was generated from. The raw PNGs stay in the (git-ignored) generation folder.

    python scripts/portraits/build_library.py 20261002T095001Z
"""
import json, os, sys
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import library  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def main(stamp: str):
    src = os.path.join(ROOT, "data", "portraits", "generations", stamp)
    dst = os.path.join(ROOT, "data", "portraits", "library")
    os.makedirs(dst, exist_ok=True)
    spec = {e["id"]: e for e in library.build()}
    entries = []
    for e in sorted(spec.values(), key=lambda e: e["id"]):
        png = os.path.join(src, f"{e['id']}.png")
        if not os.path.exists(png):
            continue
        im = Image.open(png).convert("RGB")
        orig = im.size
        w = 640
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        im.save(os.path.join(dst, f"{e['id']}.jpg"), "JPEG", quality=84, optimize=True)
        entries.append({"id": e["id"], "file": f"{e['id']}.jpg", "generation": stamp, "originalSize": list(orig), "spec": e})
    with open(os.path.join(dst, "manifest.json"), "w") as f:
        json.dump({
            "note": "Every portrait is a generated image of an invented person. A library of this size is reused across all profiles (see src/vision/assign.ts).",
            "generation": stamp, "count": len(entries), "entries": entries,
        }, f, indent=1)
    print(f"{len(entries)} portraits -> {dst}")


if __name__ == "__main__":
    main(sys.argv[1])
