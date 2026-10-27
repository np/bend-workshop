# A project's zip carries its id: imported back, it is a new version of
# that project (snapshots before and after, Undo), not a new project; an
# unknown id makes a project that keeps it. A snapshot exports alone, and
# any two versions compare as a diff.
import time, os, tempfile, zipfile, json
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
URL = "http://localhost:8123/index.html"
A = "import Base\n\ndef main() -> Nat:\n  1n\n"
B = "import Base\n\ndef two() -> Nat:\n  2n\n\ndef main() -> Nat:\n  two()\n"
C = "import Base\n\ndef main() -> Nat:\n  3n\n"
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000); time.sleep(0.5)
def code(page): return page.evaluate("document.querySelector('#ed-ta').value")
def projects(page):
    page.click("#btn-proj"); time.sleep(0.2)
    n = page.locator(".proj-open").count()
    page.click(".sheet-head button"); return n
def download(page, click):
    with page.expect_download() as dl:
        click()
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
    return path
def import_file(page, path):
    page.click("#btn-proj")
    with page.expect_file_chooser() as fc:
        page.click("text=Import…")
    fc.value.set_files(path); time.sleep(1.0)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(locale="en-US", viewport={"width": 1280, "height": 800}, accept_downloads=True)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_selector("#verdict", timeout=30000); time.sleep(0.8)
    set_code(page, A)
    page.click("#btn-proj"); page.click("text=Snapshot"); time.sleep(0.3); page.click(".sheet-head button")
    set_code(page, B)
    pid = page.evaluate("JSON.parse(localStorage.getItem('bend-play:v2')).current")
    page.click("#btn-proj")
    path = download(page, lambda: page.click("text=Export as .zip"))
    z = zipfile.ZipFile(path)
    meta = [n for n in z.namelist() if n.endswith(".workshop/project.json")]
    check("1 zip with the id:", meta != [], meta and json.loads(z.read(meta[0]))["id"] == pid)
    n0 = projects(page)
    set_code(page, C)
    import_file(page, path)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    check("2 a new version, not a project:", code(page) == B, projects(page) == n0, "new version" in page.inner_text("#status"))
    page.locator("#status .toast button", has_text="Undo").click(); time.sleep(0.5)
    check("2 undo:", code(page) == C)
    # 3 the history: a snapshot exported, a diff
    page.click("#btn-proj"); page.click(".hist > summary"); time.sleep(0.2)
    first = page.locator(".snap").last  # the oldest: A
    p2 = download(page, lambda: first.locator("button", has_text="Export").click())
    z2 = zipfile.ZipFile(p2)
    mains = [n for n in z2.namelist() if n.endswith("main.bend")]
    check("3 snapshot exported:", os.path.basename(p2), z2.read(mains[0]).decode() == A, any(n.endswith("project.json") for n in z2.namelist()))
    first.locator("button", has_text="Diff").click(); time.sleep(0.4)
    adds = page.locator(".diff .add").all_inner_texts()
    dels = page.locator(".diff .del").all_inner_texts()
    check("3 diff with the current state:", dels, adds, "-   1n" in dels, "+   3n" in adds)
    page.screenshot(path=shot("shot_snap_diff.png"))
    page.locator(".sheet select").nth(1).select_option(index=2); time.sleep(0.3)
    check("3 diff between two snapshots:", page.locator(".diff-file").count() >= 1)
    page.click(".sheet-head button")
    # 4 an id unknown here: a new project keeping it
    page.evaluate("localStorage.clear()"); page.evaluate("indexedDB.deleteDatabase('bend-workshop')")
    page.reload(); page.wait_for_selector("#verdict", timeout=30000); time.sleep(0.8)
    import_file(page, path); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    now = page.evaluate("JSON.parse(localStorage.getItem('bend-play:v2')).current")
    check("4 the id kept:", now == pid, code(page) == B)
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
