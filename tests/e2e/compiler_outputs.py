import time, os, tempfile
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
serve("dist", 8124, csp="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'none'")
COUNT = """window.__emits = []; const pm = Worker.prototype.postMessage; Worker.prototype.postMessage = function (m, t) { if (m && m.op === 'emit') window.__emits.push(m.target + (m.extra ? '+C' : '')); return pm.call(this, m, t); };"""
PROG = "import Base\n\ndef twice(+n: U32) -> U32:\n  (n + n : U32)\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    IO.print(U32.show(twice(21)))\n"
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def info(page): return page.inner_text("#js-info")
def wait_built(page):
    page.wait_for_function("() => { const t = document.querySelector('#js-info').textContent; return !/Building|waiting|Compilation|attente/.test(t); }", timeout=30000); time.sleep(0.2)
with sync_playwright() as p:
    b = p.chromium.launch()
    for port, label in [(8123, "workers"), (8124, "no workers")]:
        ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US", accept_downloads=True)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.add_init_script(COUNT)
        page.goto("http://localhost:%d/index.html" % port); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
        set_code(page, PROG); time.sleep(1.5)
        print("==", label, "| emits before opening the tab:", page.evaluate("window.__emits"))
        page.click(".tab[data-tab=js]"); wait_built(page)
        print("   tab:", page.inner_text(".tab[data-tab=js]"), "| targets:", page.locator("#out-targets .chip").all_inner_texts(), "| js:", info(page))
        for tg in ["JS module", "C", "BendTT"]:
            page.locator("#out-targets .chip", has_text=tg).click(); wait_built(page)
            first = page.evaluate("document.querySelector('#js-code').textContent.slice(0, 50)").replace("\n", " ")
            print("  ", tg.ljust(9), "|", info(page), "| starts:", first[:40])
        page.locator("#out-targets .chip", has_text="C").click(); time.sleep(0.4)
        print("   back to C:", info(page))
        print("   emits so far:", page.evaluate("window.__emits"))
        # typing with the tab shown: rebuilt once typing stops, for the target shown only
        page.locator("#out-targets .chip", has_text="JS").first.click(); wait_built(page)
        page.evaluate("window.__emits = []")
        set_code(page, PROG.replace("21", "22")); time.sleep(0.3)
        print("   while typing:", info(page)[:45])
        wait_built(page); time.sleep(1.5)
        print("   after typing:", info(page)[:60], "| emits:", page.evaluate("window.__emits"))
        # typing with the tab hidden: nothing is built
        page.click(".tab[data-tab=out]"); page.evaluate("window.__emits = []")
        set_code(page, PROG.replace("21", "23")); time.sleep(3)
        print("   tab hidden, emits:", page.evaluate("window.__emits"))
        if port == 8123:
            page.click(".tab[data-tab=js]"); wait_built(page)
            page.locator("#out-targets .chip", has_text="C").click(); wait_built(page)
            with page.expect_download() as dl:
                page.click("#js-save")
            path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
            print("   download:", dl.value.suggested_filename, os.path.getsize(path), "bytes, int main:", "int main(" in open(path).read())
            # a library and a file with holes
            set_code(page, "import Base\n\ndef double(+n: U32) -> U32:\n  (n + n : U32)\n"); time.sleep(0.3); wait_built(page); time.sleep(1.6); wait_built(page)
            print("   library, C:", info(page), "|", page.evaluate("document.querySelector('#js-code').textContent.slice(0, 60)"))
            page.locator("#out-targets .chip", has_text="JS module").click(); wait_built(page)
            print("   library, module:", info(page))
            set_code(page, "import Base\n\ndef f(+n: U32) -> U32:\n  ?h\n"); time.sleep(0.3); wait_built(page); time.sleep(1.6); wait_built(page)
            print("   holes:", info(page))
            page.screenshot(path=shot("shot_out.png"))
        for e in errs: print("!!", e[:200])
        ctx.close()
    b.close()
