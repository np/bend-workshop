# The agent's delete_file: a file goes, a snapshot first ("before deleting
# old.bend"); refused for the file checks start from, a locked file, a
# file that does not exist. The history's snapshot brings it back.
import os, time, json
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
MOCK = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_claude.py")).read().split('MOCK = """', 1)[1].split('"""', 1)[0]
SEED = json.dumps({"files": [{"name": "main.bend", "text": "import Base\n\ndef main() -> Nat:\n  1n\n"},
                             {"name": "old.bend", "text": "import Base\n\ndef gone() -> Nat:\n  2n\n"},
                             {"name": "keep.bend", "text": "import Base\n"}], "active": 0, "args": "", "live": True, "size": 15})
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *[str(m)[:300] for m in more])
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(MOCK)
    page.add_init_script("if (!localStorage.getItem('seed')) { localStorage.setItem('seed', '1'); localStorage.setItem('bend-play:v1', %s); }" % json.dumps(SEED))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4); page.click(".sheet-head button")
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.locator(".agent .chip", has_text="The project").click(); time.sleep(0.2)
    page.locator(".agent-files .chip", has_text="keep.bend").click(); time.sleep(0.2)
    page.evaluate("""window.__plan = [[['delete_file', {path: 'main.bend'}], ['delete_file', {path: 'keep.bend'}], ['delete_file', {path: 'nope.bend'}],
      ['delete_file', {path: 'old.bend'}], ['list_files', {}]]]""")
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.5)
    log = page.evaluate("window.__seen")[0]["log"]
    for l in log: print("  ", l[:160])
    check("the entry file is refused", "Error" in log[0] and "checks start from" in log[0], log[0])
    check("a locked file is refused", "Error" in log[1] and "locked" in log[1], log[1])
    check("a missing file is refused", "Error" in log[2] and "no file" in log[2], log[2])
    check("old.bend deleted, the project checked", "Error" not in log[3] and "verdict" in log[3], log[3])
    files = [x.strip() for x in page.locator(".file").all_inner_texts()]
    check("the files", "old.bend" not in " ".join(files) and len(files) == 2, files)
    snaps = page.evaluate("Object.keys(localStorage).filter(k => k.startsWith('bend-play:s:')).map(k => JSON.parse(localStorage.getItem(k))).flat().map(s => [s.label, s.files.map(f => f[0])])")
    kept = page.evaluate("Object.keys(localStorage).filter(k => k.startsWith('bend-play:s:')).map(k => JSON.parse(localStorage.getItem(k))).flat().filter(s => s.keep).map(s => s.files.map(f => f[0]))")
    check("a snapshot kept before, holding old.bend", any("old.bend" in f for f in kept), snaps)
    check("the journal shows the deletion", "old.bend" in page.inner_text("#pane-agent"))
    for e in errs: print("!!", e[:300])
    b.close()
