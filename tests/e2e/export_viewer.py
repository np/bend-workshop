import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
MOCK = """window.__saved = []; window.claude = { use: async (n) => n === 'downloads' ? { save: async (req) => {
  window.__saved.push({ filename: req.filename, blob: req.data instanceof Blob, size: req.data.size || req.data.length });
  if (window.__refuse && /\\.zip$/.test(req.filename)) { throw { code: 'extension_not_enabled', message: 'no' }; }
  return { status: 'saved' }; } } : null };"""
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(locale="fr-FR", viewport={"width": 390, "height": 780}, is_mobile=True, has_touch=True).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(MOCK)
    page.goto("http://localhost:8123/index.html")
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.click("#btn-proj"); page.click("text=Exporter en .zip"); time.sleep(0.5)
    print("viewer save:", page.evaluate("window.__saved"))
    page.evaluate("window.__refuse = true; window.__saved = []")
    page.click("#btn-proj"); page.click("text=Exporter en .zip"); time.sleep(0.5)
    print("zip refused → json:", page.evaluate("window.__saved"))
    print("header name:", page.inner_text("#proj-name"), "| width:", page.evaluate("document.querySelector('#btn-proj').getBoundingClientRect().width"))
    page.screenshot(path=shot("shot_p2.png"), clip={"x": 0, "y": 0, "width": 390, "height": 60})
    for e in errs: print("!!", e[:200])
    b.close()
