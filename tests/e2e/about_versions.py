# The head of About: which workshop and which Bend this page is, each
# linked to its commit, the source, a prefilled issue, and a copy of the
# versions; at 360 px, in English and French, without a horizontal scroll.
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
with sync_playwright() as p:
    b = p.chromium.launch()
    for loc in ("en-US", "fr-FR"):
        ctx = b.new_context(viewport={"width": 360, "height": 740}, locale=loc, is_mobile=True, has_touch=True)
        ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
        page.click("#btn-about"); time.sleep(0.4)
        text = page.inner_text(".versions")
        bend = page.evaluate("BendCore.VERSION + ' · ' + BendCore.COMMIT")
        hrefs = [a.get_attribute("href") for a in page.locator(".versions a").all()]
        print(loc, "|", text.replace("\n", " | "))
        assert bend in text.replace("\n", " "), "Bend's version missing"
        assert any("/bendlang/bend/commit/" in h for h in hrefs) and any(h.endswith("/issues/new") or "/issues/new?" in h for h in hrefs)
        page.locator(".ver-links button").click(); time.sleep(0.3)
        clip = page.evaluate("navigator.clipboard.readText()")
        print("  copied:", clip.replace("\n", " / "), "| width:", page.evaluate("document.documentElement.scrollWidth"))
        assert "Bend " in clip and page.evaluate("document.documentElement.scrollWidth") <= 360
        page.screenshot(path=shot("shot_about_versions_" + loc + ".png"))
        for e in errs: print("!!", e[:200])
        ctx.close()
    b.close()
