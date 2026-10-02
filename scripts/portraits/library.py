"""
The portrait library spec: 60 invented people, described by what the photograph shows.

Every entry is a deterministic combination of attributes (no randomness at import time), so the
library is reproducible. The people are fictional. Prompts ask for a person who does not
resemble anyone real, and nothing here names, or is modelled on, a real individual.

The attributes that describe the *photograph* (setting, activity, solo/group, photo type,
quality) are recorded in the spec. They are the ground truth the descriptive-feature extractor
in `src/vision` is validated against. They never describe how attractive anyone is.
"""
from __future__ import annotations

# (setting_class, detail, activity, activity_kind)
SCENES = [
    ("indoor", "a bright home kitchen", "chopping vegetables", "food"),
    ("indoor", "a ceramics studio with shelves of pots", "shaping a bowl at a wheel", "craft"),
    ("indoor", "a small neighbourhood bookshop", "browsing a shelf", "culture"),
    ("indoor", "a climbing gym", "chalking hands before a route", "sport"),
    ("indoor", "a cafe with large windows", "reading with a coffee", "culture"),
    ("indoor", "a living room with a record player", "choosing a vinyl record", "culture"),
    ("indoor", "a woodworking workshop", "sanding a table leg", "craft"),
    ("indoor", "a rehearsal room with a piano", "playing the piano", "culture"),
    ("indoor", "a cluttered home office", "looking up from a laptop", "everyday"),
    ("indoor", "a restaurant table at night", "laughing over dinner", "social"),
    ("outdoor", "a harbour with small boats", "coiling a rope", "outdoors"),
    ("outdoor", "a city park in autumn", "walking a dog", "outdoors"),
    ("outdoor", "a rooftop terrace at golden hour", "holding a glass", "social"),
    ("outdoor", "a farmers market", "choosing fruit at a stall", "food"),
    ("outdoor", "a tennis court", "resting between games", "sport"),
    ("outdoor", "a community garden", "kneeling to plant seedlings", "outdoors"),
    ("nature", "a mountain trail above a valley", "hiking with a small backpack", "outdoors"),
    ("nature", "a rocky coastline", "standing at the water's edge", "outdoors"),
    ("nature", "a pine forest path", "stopping to look up", "outdoors"),
    ("nature", "a quiet lake shore", "sitting on a jetty", "outdoors"),
    ("nature", "a beach at low tide", "carrying a surfboard", "sport"),
    ("nature", "a camping spot beside a river", "pouring coffee from a pot", "outdoors"),
    ("urban", "a narrow old-town street", "walking past tiled walls", "everyday"),
    ("urban", "a tram stop in the rain", "waiting under an umbrella", "everyday"),
    ("urban", "a street market at dusk", "eating street food", "food"),
    ("urban", "a cycle lane by a canal", "standing beside a bicycle", "everyday"),
    ("urban", "a gallery opening", "looking at a painting", "culture"),
    ("urban", "a train platform", "carrying a small bag", "everyday"),
    ("urban", "a bridge over a river at sunset", "leaning on the railing", "everyday"),
    ("urban", "an open-air concert crowd", "dancing", "social"),
]

AGES = [24, 27, 29, 31, 33, 36, 39, 43, 26, 30, 34, 41]
GENDER_CYCLE = ["woman", "man", "woman", "man", "nonbinary person", "woman", "man", "woman", "man", "woman"]
LOOKS = [
    "light skin and short dark hair", "olive skin and long wavy brown hair", "dark brown skin and close-cropped hair",
    "medium brown skin and a ponytail", "pale skin with freckles and red hair", "East Asian features and a bob haircut",
    "South Asian features and long black hair", "tan skin and curly grey-flecked hair", "Black woman with natural curls",
    "light skin, blond hair and glasses", "Southeast Asian features and shoulder-length hair", "Middle Eastern features and a short beard",
    "medium skin with a shaved head", "olive skin and a grey streak in dark hair",
]
PHOTO_TYPES = ["candid", "posed", "portrait"]
PEOPLE = ["solo", "solo", "group"]
QUALITY = [
    ("good", "well lit, sharp, natural light"),
    ("good", "well lit, sharp, soft window light"),
    ("dim", "dim and a little underexposed, indoor evening light"),
    ("soft", "slightly soft focus and mild motion blur, taken on a phone"),
    ("good", "clean daylight, sharp"),
    ("harsh", "harsh on-camera flash, flat lighting, phone snapshot"),
]
TYPE_TEXT = {
    "candid": "a candid photo, the person not looking at the camera",
    "posed": "a posed photo, the person looking at the camera and smiling",
    "portrait": "a head-and-shoulders portrait, neutral relaxed expression",
}

def build(n: int = 60) -> list[dict]:
    out = []
    for i in range(n):
        setting, detail, activity, akind = SCENES[(i * 7) % len(SCENES)]
        gender = GENDER_CYCLE[i % len(GENDER_CYCLE)]
        looks = LOOKS[(i * 5 + i // 7) % len(LOOKS)]
        if gender == "nonbinary person":
            looks = looks.replace("Black woman", "Black person").replace("beard", "short hair")
        elif gender == "woman":
            looks = looks.replace("short beard", "short hair")
        elif gender == "man":
            looks = looks.replace("Black woman with", "Black man with")
        age = AGES[(i * 5) % len(AGES)] + (i // 12)
        ptype = PHOTO_TYPES[(i * 3 + i // 4) % 3]
        people = PEOPLE[(i + i // 3) % len(PEOPLE)]
        qclass, qtext = QUALITY[(i * 5 + i // 3) % len(QUALITY)]
        if ptype == "portrait":
            people = "solo"  # a head-and-shoulders portrait is one person
        group_text = " Two friends are visible beside them, smiling." if people == "group" else " Only this one person is in the frame."
        activity_text = "" if ptype == "portrait" else f" The person is {activity}."
        prompt = (
            f"Create a photorealistic photograph of a fictional {gender}, about {age} years old, with {looks}. "
            f"Setting: {detail}.{activity_text}{group_text} It is {TYPE_TEXT[ptype]}. Lighting and quality: {qtext}. "
            "The person is invented and must not resemble any real or famous individual. "
            "Portrait orientation, 4:5, no text, no watermark, no logos."
        )
        out.append({
            "id": f"lib_{i + 1:03d}", "age": age, "gender": gender, "looks": looks,
            "setting": setting, "detail": detail, "activity": None if ptype == "portrait" else activity,
            "activityKind": "none" if ptype == "portrait" else akind,
            "people": people, "photoType": ptype, "quality": qclass, "prompt": prompt,
        })
    return out

if __name__ == "__main__":
    import json, collections
    lib = build()
    for k in ("setting", "people", "photoType", "quality", "gender"):
        print(k, dict(collections.Counter(e[k] for e in lib)))
    print(len({e["detail"] for e in lib}), "distinct scenes;", len({e["looks"] for e in lib}), "distinct looks")
    print(lib[0]["prompt"])
