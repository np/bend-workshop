import time, json
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
MOCK = "window.claude = { use: async (n) => n === 'sample' ? Object.assign(async () => ({ text: '' }), {}) : null };"
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
with sync_playwright() as p:
    b = p.chromium.launch()
    for w in [360, 390]:
        page = b.new_context(viewport={"width": w, "height": 740}, locale="fr-FR", is_mobile=True, has_touch=True).new_page()
        page.add_init_script(MOCK + " localStorage.setItem('bend-play:v2', JSON.stringify({current: 'x', order: ['x'], live: true, size: 14, lang: 'fr', ai: {provider: 'claude', url: '', model: '', key: ''}}));")
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.5)
        for name, hole in [("court", "?g"), ("long", "?g_nil_false")]:
            set_code(page, "import Base\n\ndef f(xs: List<U32>, n: Nat) -> U32:\n  " + hole + "\n")
            page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.5)
            page.evaluate("document.querySelector('#ed-ta').blur()"); time.sleep(0.3)
            c = page.locator(".goal").first
            lw = page.evaluate("document.querySelector('.goals-list').clientWidth")
            chips = [(x.inner_text(), round(x.bounding_box()["x"] + x.bounding_box()["width"])) for x in c.locator(".goal-head .chip").all()]
            hidden = [t for t, r in chips if r > lw]
            print(w, name, "| width", lw, "| chips:", chips, "| off-screen:", hidden)
            if w == 360 and name == "long": page.screenshot(path=shot("shot_s_360.png"))
        page.close()
    b.close()
