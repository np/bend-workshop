# Git: the changes that go in a commit (one unticked stays changed, out of
# the commit; Untick all disables Commit), a message over several lines
# (its first line in the history, the rest folded; real git reads it whole),
# Ctrl+Enter commits; a phone's width.
import time, os, tempfile, zipfile, subprocess
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *[str(m)[:400] for m in more])
def set_file(page, name, code):
    page.evaluate("(n) => document.querySelector(`.file[data-name='${n}']`).click()", name); time.sleep(0.4)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
    time.sleep(0.8)
def git_sheet(page):
    if page.locator(".sheet").count(): page.click(".sheet-head button"); time.sleep(0.2)
    page.click("#btn-proj"); time.sleep(0.2)
    page.locator(".sheet .btn", has_text="Git…").click(); time.sleep(1.0)
def wait_note(page):
    for _ in range(100):
        if page.locator(".git-note").count() and not page.inner_text(".git-note").strip(): return
        time.sleep(0.2)
SEED = '{"files": [{"name": "main.bend", "text": "import Base\\n\\ndef main() -> Nat:\\n  1n\\n"}, {"name": "lib.bend", "text": "import Base\\n\\ndef two() -> Nat:\\n  2n\\n"}], "active": 0, "args": "", "live": true, "size": 15}'
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US", accept_downloads=True)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script("if (!localStorage.getItem('seed')) { localStorage.setItem('seed', '1'); localStorage.setItem('bend-play:v1', %s); }" % repr(SEED))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.0)
    git_sheet(page)
    page.locator(".git .btn", has_text="Create a repository").click(); time.sleep(1.5)
    page.fill(".git textarea.git-msg", "first"); page.locator(".git .btn", has_text="Commit").click(); time.sleep(1.0); wait_note(page)
    page.click(".sheet-head button")
    set_file(page, "main.bend", "import Base\n\ndef main() -> Nat:\n  3n\n")
    set_file(page, "lib.bend", "import Base\n\ndef two() -> Nat:\n  22n\n")
    page.set_viewport_size({"width": 360, "height": 740}); time.sleep(0.3)
    git_sheet(page)
    rows = page.locator(".git-change")
    check("two changes, each with a box, ticked", rows.count() == 2 and all(rows.nth(i).locator("input").is_checked() for i in range(2)), page.inner_text(".git-changes"))
    page.locator(".git-change", has_text="lib.bend").locator("input").uncheck(); time.sleep(0.2)
    check("count says what goes in", "1 of 2" in page.inner_text(".git"), page.inner_text(".git")[:200])
    page.locator(".git .chip", has_text="Untick all").click(); time.sleep(0.2)
    check("nothing ticked: Commit off", page.locator(".git .btn", has_text="Commit").is_disabled())
    page.locator(".git .chip", has_text="Tick all").click(); time.sleep(0.2)
    page.locator(".git-change", has_text="lib.bend").locator("input").uncheck(); time.sleep(0.2)
    wide = page.evaluate("document.documentElement.scrollWidth")
    check("fits the phone", wide <= 360, wide)
    page.screenshot(path=shot("shot_git_pick.png"))
    msg = page.locator(".git textarea.git-msg")
    msg.fill("Main returns 3\n\nOnly main.bend: lib.bend waits.\nSecond line.")
    msg.press("Control+Enter"); time.sleep(1.5); wait_note(page)
    txt = page.inner_text(".git")
    check("the unticked file is still changed, still unticked", "0 of 1" in txt and "lib.bend" in page.inner_text(".git-changes") and not page.locator(".git-change input").first.is_checked(), txt[:300])
    first = page.locator(".git-commit").first
    check("history: the first line, the rest folded", "Main returns 3" in first.inner_text() and first.locator("details.git-body").count() == 1, first.inner_text()[:200])
    first.locator("details.git-body summary").click(); time.sleep(0.2)
    check("the body opens", "Only main.bend: lib.bend waits.\nSecond line." in first.locator("details.git-body pre").inner_text())
    page.set_viewport_size({"width": 1280, "height": 800}); time.sleep(0.3)
    # real git: what the commit holds, its message whole
    page.click(".sheet-head button"); page.click("#btn-proj")
    with page.expect_download() as dl:
        page.click("text=Export as .zip")
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
    out = tempfile.mkdtemp(); zipfile.ZipFile(path).extractall(out)
    top = os.path.join(out, os.listdir(out)[0])
    body = subprocess.run(["git", "log", "-1", "--format=%B"], cwd=top, capture_output=True, text=True).stdout
    check("real git: the message whole", body.strip() == "Main returns 3\n\nOnly main.bend: lib.bend waits.\nSecond line.", repr(body))
    names = subprocess.run(["git", "show", "--name-only", "--format=", "HEAD"], cwd=top, capture_output=True, text=True).stdout.split()
    check("real git: only main.bend in it", names == ["main.bend"], names)
    lib = subprocess.run(["git", "show", "HEAD:lib.bend"], cwd=top, capture_output=True, text=True).stdout
    check("lib.bend as the first commit has it", "2n" in lib and "22n" not in lib, lib)
    for e in errs: print("!!", e[:300])
    b.close()
