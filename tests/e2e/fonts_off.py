# The fonts are inside the page: no request at all, the editor in the
# workshop's mono; off in Settings, the system's fonts, still aligned; under
# a policy that refuses inline fonts (claude.ai's viewer), Google Fonts.
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
serve("dist", 8125, csp="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; worker-src 'self' blob:")
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 780}, locale="en-US", is_mobile=True, has_touch=True)
    reqs = []
    ctx.on("request", lambda r: reqs.append(r.url[:60]) if not r.url.startswith(("http://localhost:8123", "blob:", "data:")) else None)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000); time.sleep(1.0)
    loaded = page.evaluate("Promise.all([document.fonts.load(\"12px 'Workshop Mono'\"), document.fonts.load(\"12px 'Workshop Serif'\")]).then((xs) => xs.every((x) => x.length > 0 && x[0].status === 'loaded'))")
    check("1 no request, fonts inside:", sorted(set(reqs)), reqs == [], loaded, page.locator("#gf-css").count() == 0)
    page.click("#btn-settings"); time.sleep(0.3)
    box = page.locator(".sheet label.check", has_text="fonts").locator("input")
    check("2 setting checked:", box.is_checked())
    page.screenshot(path=shot("shot_privacy.png"))
    box.uncheck(); time.sleep(0.4)
    check("3 off:", page.evaluate("document.documentElement.classList.contains('sysfonts')"), page.evaluate("JSON.parse(localStorage.getItem('bend-play:v2')).fonts") is False)
    page.click(".sheet-head button")
    page.reload(); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    fam = page.evaluate("getComputedStyle(document.querySelector('#ed-ta')).fontFamily")
    aligned = page.evaluate("(() => { const ta = document.querySelector('#ed-ta'), pre = document.querySelector('pre.ed-hl'); return [pre.offsetHeight, ta.scrollHeight, getComputedStyle(pre).lineHeight, getComputedStyle(ta).lineHeight]; })()"); print(aligned); aligned = aligned[2] == aligned[3]
    check("4 reload, system fonts:", fam[:30], "Workshop" not in fam, aligned, reqs == [])
    ctx.close()
    # a host that refuses inline fonts
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
    reqs2 = []
    ctx.on("request", lambda r: reqs2.append(r.url[:40]) if "googleapis" in r.url else None)
    page = ctx.new_page()
    page.goto("http://localhost:8125/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.5)
    check("5 refused inline: Google Fonts asked:", page.locator("#gf-css").count() == 1, len(reqs2) >= 1)
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
