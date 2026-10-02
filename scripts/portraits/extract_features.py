"""
Descriptive visual features for the portrait library.

DECISION, recorded here and in src/vision/features.ts: this extracts what the PHOTOGRAPH shows,
never a judgement of the person. There is no attractiveness score, no face rating, and nothing
inferred about age, gender, ethnicity, health or any other characteristic of the person.
Ranking people by facial attractiveness is unreliable (raters disagree, models inherit the
biases of their training data) and indefensible (it is special-category biometric profiling
with no lawful basis, and it launders prejudice as a number). The honest alternative is
descriptive features of the image: setting, visible activity, solo or group, apparent photo
type, and a rough technical quality signal. A preference model can legitimately learn from
those, and a person can read and dispute every one of them.

Two sources, both local and free:
  * OpenCV pixel statistics: resolution, brightness, contrast, sharpness, clipped highlights.
  * A local vision-language model (Ollama, gemma3:4b) that is asked ONLY about the scene.
    The prompt does not mention the person's body, face, age, gender or appearance.

The generation spec is NOT shown to the model; it is used afterwards only to measure how often
the extractor agrees with what was asked for (extraction-eval.json).

    python scripts/portraits/extract_features.py
"""
import base64, json, os, time, urllib.request
import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LIB = os.path.join(ROOT, "data", "portraits", "library")
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("VISION_MODEL", "gemma3:4b")

SCHEMA = {
    "type": "object",
    "properties": {
        "setting": {"type": "string", "enum": ["indoor", "outdoor", "nature", "urban"]},
        "activity_kind": {"type": "string", "enum": ["food", "craft", "culture", "sport", "outdoors", "social", "everyday", "none"]},
        "people": {"type": "string", "enum": ["solo", "group"]},
        "photo_type": {"type": "string", "enum": ["candid", "posed", "portrait"]},
    },
    "required": ["setting", "activity_kind", "people", "photo_type"],
}

PROMPT = (
    "Classify this photograph. Describe the photograph only: where it was taken and how it was framed. "
    "Do not describe the person.\n"
    "setting: indoor (the subject is inside a room or building: a home, shop, cafe, restaurant, gallery, gym or workshop), "
    "outdoor (outside in a garden, park, sports area or harbour), "
    "nature (wild landscape: mountains, forest, coast, lake, beach), urban (outside in a city: streets, transit stops, "
    "markets, bridges, rooftops, crowds).\n"
    "activity_kind: what the main subject is doing. food (cooking, eating, shopping for food), craft (making or building "
    "something with hands), culture (reading, music, art, galleries, records), sport (exercise, climbing, tennis, surfing), "
    "outdoors (walking, hiking, gardening, boats, camping, standing in a landscape), social (a party, dinner with others, "
    "dancing, drinks), everyday (commuting, working at a desk, walking in a street), none (use this whenever the subject "
    "is simply looking at the camera in a close head-and-shoulders frame).\n"
    "people: solo if exactly one person is in the frame, group if two or more people are visible.\n"
    "photo_type: candid (the subject is mid-activity and not looking at the camera), posed (the subject looks at the camera "
    "and smiles, framed wider than a close-up so the scene is visible), portrait (a close head-and-shoulders frame with a relaxed or "
    "neutral expression).\n"
    "Answer with JSON only."
)


def pixel_stats(path: str) -> dict:
    img = cv2.imread(path)
    h, w = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Sharpness at a fixed 512px width so it is comparable across sizes.
    g512 = cv2.resize(g, (512, round(h * 512 / w)), interpolation=cv2.INTER_AREA)
    lap = cv2.Laplacian(g512, cv2.CV_64F).var()
    gf = g.astype(np.float64) / 255.0
    return {
        "width": int(w), "height": int(h), "megapixels": round(w * h / 1e6, 3),
        "brightness": round(float(gf.mean()), 4),
        "contrast": round(float(gf.std()), 4),
        "sharpness": round(float(lap), 2),
        "clippedHighlights": round(float((gf > 0.97).mean()), 4),
        "underexposed": round(float((gf < 0.08).mean()), 4),
    }


def ask(path: str) -> dict:
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    body = {"model": MODEL, "stream": False, "format": SCHEMA, "options": {"temperature": 0},
            "messages": [{"role": "user", "content": PROMPT, "images": [b64]}]}
    req = urllib.request.Request(f"{OLLAMA}/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.loads(json.loads(r.read())["message"]["content"])


def main():
    manifest = json.load(open(os.path.join(LIB, "manifest.json")))
    gen_dir = os.path.join(ROOT, "data", "portraits", "generations", manifest["generation"])
    out, hits = [], {"setting": [0, 0], "activityKind": [0, 0], "people": [0, 0], "photoType": [0, 0]}
    confusion = {k: {} for k in hits}
    for e in manifest["entries"]:
        t0 = time.time()
        raw = os.path.join(gen_dir, e["id"] + ".png")
        stats = pixel_stats(raw if os.path.exists(raw) else os.path.join(LIB, e["file"]))
        vlm = ask(os.path.join(LIB, e["file"]))
        feat = {"id": e["id"], "setting": vlm["setting"], "activityKind": vlm["activity_kind"], "people": vlm["people"],
                "photoType": vlm["photo_type"], "pixels": stats}
        out.append(feat)
        s = e["spec"]
        truth = {"setting": s["setting"], "activityKind": s["activityKind"], "people": s["people"], "photoType": s["photoType"]}
        for k in hits:
            hits[k][1] += 1
            hits[k][0] += int(feat[k] == truth[k])
            key = f"{truth[k]} -> {feat[k]}"
            confusion[k][key] = confusion[k].get(key, 0) + 1
        print(f"{e['id']} {feat['setting']}/{feat['activityKind']}/{feat['people']}/{feat['photoType']} ({time.time() - t0:.0f}s)", flush=True)
    with open(os.path.join(LIB, "features.json"), "w") as f:
        json.dump({"extractor": {"pixels": "opencv", "scene": MODEL, "temperature": 0}, "features": out}, f, indent=1)
    ev = {
        "extractor": MODEL, "n": len(out),
        "agreementWithGenerationSpec": {k: {"agree": a, "of": n, "rate": round(a / n, 3)} for k, (a, n) in hits.items()},
        "confusion": confusion,
        "note": "The spec is what the generator was ASKED to draw. The image generator can drift from its prompt, so disagreement is not purely extractor error. The extractor prompt was revised once after a first pass over these same 60 portraits (definitions of indoor versus urban, and of none and portrait, were clarified); that first pass is kept in extraction-eval.pass1.json, and the agreement rates here are therefore mildly optimistic.",
    }
    with open(os.path.join(LIB, "extraction-eval.json"), "w") as f:
        json.dump(ev, f, indent=1)
    print(json.dumps(ev["agreementWithGenerationSpec"], indent=1))


if __name__ == "__main__":
    main()
