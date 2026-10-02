"""
Generate the portrait library through the free Gemini web UI (Playwright, persistent profile).

No API, no key, no spend. If the web lane rate-limits, this script paces itself and then stops
and reports; it never falls back to a paid service.

Every run writes into its own timestamped folder: data/portraits/generations/<UTC stamp>/
containing the raw PNGs, a screenshot per attempt and manifest.jsonl. Nothing is overwritten.
Resume with --resume <stamp>: entries already saved in that folder are skipped.

    python scripts/portraits/generate.py --limit 3
    python scripts/portraits/generate.py --resume 20261002T101500Z
"""
import argparse, asyncio, base64, datetime, json, os, sys
from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import library  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GEN_ROOT = os.path.join(ROOT, "data", "portraits", "generations")
PROFILE = os.environ.get("GEMINI_PROFILE_DIR", os.path.join(os.path.expanduser("~"), ".playwright-gemini-profile"))
PACE_SECONDS = 25            # pause between successful generations
MAX_WAIT = 150               # seconds to wait for one image
BLOCK_PHRASES = ["límite", "limite", "limit", "try again later", "inténtalo más tarde", "intenta de nuevo más tarde",
                 "can't create", "cannot create", "no puedo crear", "no puedo generar", "can't generate", "not able to create"]


async def new_chat(page):
    await page.goto("https://gemini.google.com/app", wait_until="domcontentloaded")
    for _ in range(20):
        if await page.query_selector('[contenteditable="true"], textarea'):
            return
        await asyncio.sleep(1)
    raise RuntimeError("chat input never appeared")


async def submit(page, text):
    await asyncio.sleep(3)
    box = page.locator('[contenteditable="true"], textarea').first
    await box.click(timeout=15000)
    await page.keyboard.insert_text(text)
    await asyncio.sleep(1)
    for sel in ['button[aria-label*="Enviar" i]', 'button[aria-label*="Send" i]']:
        btn = await page.query_selector(sel)
        if btn and await btn.is_enabled():
            await btn.click()
            return
    await page.keyboard.press("Enter")


async def grab_image(page):
    """Return PNG bytes of the largest generated blob image, or None."""
    imgs = await page.query_selector_all('img[src*="blob:"], img[src*="googleusercontent"]')
    for img in reversed(imgs):
        try:
            w = await img.evaluate("e => e.naturalWidth"); h = await img.evaluate("e => e.naturalHeight")
            if w < 400 or h < 400:
                continue
            data = await page.evaluate("""async (el) => {
                const c = document.createElement('canvas'); c.width = el.naturalWidth; c.height = el.naturalHeight;
                c.getContext('2d').drawImage(el, 0, 0); return c.toDataURL('image/png').split(',')[1]; }""", img)
            if data:
                return base64.b64decode(data)
        except Exception:
            continue
    return None


async def one(page, entry, out_dir):
    await new_chat(page)
    await submit(page, entry["prompt"])
    t0 = asyncio.get_event_loop().time()
    png = None
    while asyncio.get_event_loop().time() - t0 < MAX_WAIT:
        await asyncio.sleep(6)
        png = await grab_image(page)
        if png:
            break
        body = (await page.inner_text("body")).lower()
        if any(p in body for p in BLOCK_PHRASES) and await page.query_selector('model-response, message-content'):
            # Might be a refusal or a quota message; stop waiting, screenshot, classify below.
            await asyncio.sleep(4)
            png = await grab_image(page)
            break
    await page.screenshot(path=os.path.join(out_dir, f"{entry['id']}-screen.png"))
    if png:
        with open(os.path.join(out_dir, f"{entry['id']}.png"), "wb") as f:
            f.write(png)
        return "ok", None
    text = ""
    try:
        text = (await page.inner_text("body"))[-600:]
    except Exception:
        pass
    low = text.lower()
    return ("blocked" if any(p in low for p in BLOCK_PHRASES) else "no_image"), text


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=60)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--resume")
    ap.add_argument("--max-fail", type=int, default=3, help="consecutive failures before stopping")
    a = ap.parse_args()

    stamp = a.resume or datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = os.path.join(GEN_ROOT, stamp)
    os.makedirs(out_dir, exist_ok=True)
    lib = library.build()[a.offset:a.offset + a.limit]
    with open(os.path.join(out_dir, "library-spec.json"), "w") as f:
        json.dump(library.build(), f, indent=1)
    print(f"generation folder: {out_dir}")

    fails = 0
    async with async_playwright() as p:
        b = await p.chromium.launch_persistent_context(PROFILE, headless=False, channel="chrome",
            args=["--disable-blink-features=AutomationControlled"], viewport={"width": 1280, "height": 1100})
        page = b.pages[0] if b.pages else await b.new_page()
        for e in lib:
            if os.path.exists(os.path.join(out_dir, f"{e['id']}.png")):
                print(f"[skip] {e['id']}"); continue
            try:
                status, note = await one(page, e, out_dir)
            except Exception as ex:
                status, note = "error", str(ex)
            with open(os.path.join(out_dir, "manifest.jsonl"), "a") as f:
                f.write(json.dumps({"id": e["id"], "status": status, "note": note, "at": datetime.datetime.now(datetime.timezone.utc).isoformat()}) + "\n")
            print(f"[{status}] {e['id']}")
            if status == "ok":
                fails = 0
                await asyncio.sleep(PACE_SECONDS)
            else:
                fails += 1
                if status == "blocked" or fails >= a.max_fail:
                    print(f"STOPPING after {fails} consecutive failure(s). Last status: {status}. Not spending money; report instead.")
                    break
                await asyncio.sleep(90)  # back off before retrying the next entry
        await b.close()

if __name__ == "__main__":
    asyncio.run(main())
