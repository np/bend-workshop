# The agent's memory travels with an export: in the zip as
# .workshop/agent-memory.json (bend never reads a hidden folder), in the
# .json as memory, left out when unticked; importing gives it to the new
# project. And About downloads the page itself, which opens alone.
import os, json, time, tempfile, zipfile
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
MOCK = """window.claude = { use: async (n) => n === 'sample' ? Object.assign(async (input, opts) => {
  const tl = (opts.tools || []).find(t => t.name === 'check'); if (tl) await tl.execute({}, {});
  const text = 'Checked it.\\nSTATUS: done'; if (opts.onText) opts.onText({ text, delta: text }); return { text, truncated: false };
}, { limits: async () => ({ tools: { maxCount: 16 }, maxPromptBytes: 262144 }), json: async () => ({}) }) : null };"""
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US", accept_downloads=True)
    ctx.add_init_script(MOCK)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4); page.click(".sheet-head button")
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.fill(".agent-form textarea", "Check the project.")
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(1.0)
    tmp = tempfile.mkdtemp()
    def export(which, tick=True):
        page.click("#btn-proj"); time.sleep(0.4)
        box = page.locator(".sheet label.check", has_text="memory")
        shown = box.is_visible()
        if shown and not tick:
            box.locator("input").uncheck()
        with page.expect_download() as dl:
            page.locator(".sheet .btn", has_text="Export as ." + which).click()
        path = os.path.join(tmp, which + ("" if tick else "-bare") + "." + which)
        dl.value.save_as(path)
        return path, shown
    zpath, shown = export("zip")
    names = zipfile.ZipFile(zpath).namelist()
    memo = json.loads(zipfile.ZipFile(zpath).read([n for n in names if n.endswith("agent-memory.json")][0]))
    check("1 zip:", shown, names, any(n.endswith("/.workshop/agent-memory.json") for n in names), len(memo["msgs"]) >= 4, memo["format"] == "bend-workshop/memory/1")
    bare, _ = export("zip", tick=False)
    check("2 unticked:", not any("agent-memory" in n for n in zipfile.ZipFile(bare).namelist()))
    jpath, _ = export("json")
    check("3 json:", len(json.load(open(jpath))["memory"]["msgs"]) >= 4)
    # import the zip: a new project, its memory with it
    page.click("#btn-proj")
    with page.expect_file_chooser() as fc:
        page.click("text=Import…")
    fc.value.set_files(zpath); time.sleep(1.2)
    page.locator(".agent-modes .chip", has_text="Memory").click(); time.sleep(0.4)
    stats = page.inner_text(".mem > p")
    check("4 imported with its memory:", stats, stats.startswith(str(len(memo["msgs"])) + " messages"))
    # the page itself: on a web host, the file as served
    ctx2 = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US", accept_downloads=True)
    web = ctx2.new_page()
    web.on("pageerror", lambda e: errs.append(str(e)))
    web.goto("http://localhost:8123/index.html"); web.wait_for_selector("#verdict", timeout=30000); time.sleep(0.8)
    web.click("#btn-about"); time.sleep(0.3)
    with web.expect_download() as dl:
        web.locator(".versions .btn", has_text="Download this page").click()
    hpath = os.path.join(tmp, dl.value.suggested_filename); dl.value.save_as(hpath)
    html = open(hpath, encoding="utf-8").read()
    served = open("dist/index.html", encoding="utf-8").read()
    check("5 page, as served:", dl.value.suggested_filename, html == served)
    page2 = ctx.new_page()
    page2.on("pageerror", lambda e: errs.append(str(e)))
    page2.goto("file://" + hpath); page2.wait_for_selector("#verdict[data-state=ok]", timeout=60000)
    check("6 it opens alone:", page2.inner_text("#verdict-text")[:20])
    # from file://, the page as it was before the app ran
    page2.click("#btn-about"); time.sleep(0.3)
    with page2.expect_download() as dl:
        page2.locator(".versions .btn", has_text="Download this page").click()
    h2 = os.path.join(tmp, "again.html"); dl.value.save_as(h2)
    again = open(h2, encoding="utf-8").read()
    check("7 from file://:", len(again) > 500000, again.startswith("<!doctype html>"), 'id="gf-css"' not in again, 'id="bend-core"' in again)
    page3 = ctx.new_page()
    page3.on("pageerror", lambda e: errs.append(str(e)))
    page3.goto("file://" + h2); page3.wait_for_selector("#verdict[data-state=ok]", timeout=60000)
    check("8 and that one opens too:", page3.inner_text("#verdict-text")[:20])
    for e in errs: print("!!", e[:200])
    b.close()
