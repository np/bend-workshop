# Working with others: a push refused while origin is ahead, a pull that
# merges with a conflict (marks in the file, Keep mine, a commit with two
# parents, pushed), a pull that fast-forwards, an abort; and an empty
# remote whose HEAD names no branch (push, fetch, pull all fine).
import time, os, tempfile, subprocess
from playwright.sync_api import sync_playwright
from serve import serve
from git_server import serve_git, make_repo
serve("dist", 8123)
ROOT = tempfile.mkdtemp()
A = "import Base\n\ndef main() -> Nat:\n  1n\n"
make_repo(ROOT, "team.git", {"main.bend": A})
subprocess.run(["git", "init", "-q", "--bare", os.path.join(ROOT, "empty.git")], check=True)
subprocess.run(["git", "config", "http.receivepack", "true"], cwd=os.path.join(ROOT, "empty.git"), check=True)
serve_git(8150, ROOT)
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
def other(edit, msg):
    """The other collaborator, with the git CLI."""
    w = tempfile.mkdtemp()
    subprocess.run(["git", "clone", "-q", os.path.join(ROOT, "team.git"), w], check=True)
    old = open(os.path.join(w, "main.bend")).read()
    open(os.path.join(w, "main.bend"), "w").write(edit(old))
    subprocess.run(["git", "-c", "user.name=O", "-c", "user.email=o@x", "commit", "-qam", msg], cwd=w, check=True)
    subprocess.run(["git", "push", "-q", "origin", "main"], cwd=w, check=True)
def srv_log():
    return subprocess.run(["git", "log", "--format=%s %p", "main"], cwd=os.path.join(ROOT, "team.git"), capture_output=True, text=True).stdout.strip().split("\n")
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
    time.sleep(0.6)
def code(page): return page.evaluate("document.querySelector('#ed-ta').value")
def sheet(page):
    if page.locator(".sheet").count(): page.locator(".sheet-head button").last.click(); time.sleep(0.2)
    page.click("#btn-proj"); time.sleep(0.2); page.locator(".sheet .btn", has_text="Git…").click(); time.sleep(1.0)
def btn(page, text, wait=1.5):
    page.locator(".git .btn", has_text=text).first.click(); time.sleep(wait)
def note(page): return page.inner_text(".git-note")
def commit(page, msg=None):
    if msg: page.fill(".git input[placeholder='What changed']", msg)
    btn(page, "Commit")

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 900}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(0.8)
    sheet(page)
    page.fill(".git input[aria-label='Repository URL']", "http://127.0.0.1:8150/team.git")
    page.locator(".git .btn", has_text="Clone").click()
    page.wait_for_function("document.querySelector('#proj-name').textContent === 'team'", timeout=30000); time.sleep(0.8)
    # 1 both change the same line
    set_code(page, A.replace("1n", "2n")); sheet(page); commit(page, "mine: 2n")
    other(lambda t: t.replace("1n", "3n"), "theirs: 3n")
    btn(page, "Push", 2.0)
    check("1 push refused, pull first:", "Pull first" in note(page), note(page)[:80])
    btn(page, "Pull", 2.5)
    text = code(page)
    check("2 conflict marks:", "<<<<<<<" in text and "=======" in text and ">>>>>>>" in text, "2n" in text and "3n" in text)
    sheet(page)
    check("2 merging banner:", page.locator(".git-merging").count() == 1, "1 file in conflict" in page.inner_text(".git-merging"))
    page.locator(".git-conflict .chip", has_text="Keep mine").click(); time.sleep(0.8)
    check("3 kept mine:", "<<<<<<<" not in code(page), "  2n" in code(page), "No conflict left" in page.inner_text(".git-merging"))
    commit(page)
    btn(page, "Push", 2.0)
    log = srv_log()
    check("3 the merge commit, two parents, pushed:", log[0].startswith("Merge origin/main into main"), len(log[0].split()) >= 2 and len(log[0].split(" ")[-2:]) == 2, log[:3])
    # 4 a fast-forward
    other(lambda t: t + "\ndef two() -> Nat:\n  2n\n", "theirs: two")
    sheet(page); btn(page, "Pull", 2.5)
    check("4 fast-forward:", "def two()" in code(page), "<<<<<<<" not in code(page))
    # 5 a conflict given up
    set_code(page, code(page).replace("  2n\n\ndef two", "  5n\n\ndef two")); sheet(page); commit(page, "mine: 5n")
    other(lambda t: t.replace("  2n\n\ndef two", "  6n\n\ndef two"), "theirs: 6n")
    btn(page, "Pull", 2.5)
    sheet(page)
    btn(page, "Abort the merge", 1.5)
    check("5 aborted:", "<<<<<<<" not in code(page), "  5n" in code(page), page.locator(".git-merging").count() == 0)
    # 6 an empty remote, its HEAD on master, pushed main
    page.locator(".sheet-head button").last.click(); time.sleep(0.2)
    page.click("#btn-examples"); page.locator(".ex").first.click(); time.sleep(1.0)
    sheet(page); btn(page, "Create a repository"); commit(page, "first")
    u = page.locator(".git input[type=url]"); u.fill("http://127.0.0.1:8150/empty.git"); u.dispatch_event("change"); time.sleep(1.2)
    btn(page, "Push", 2.0)
    pushed = subprocess.run(["git", "log", "--format=%s", "main"], cwd=os.path.join(ROOT, "empty.git"), capture_output=True, text=True).stdout.strip()
    check("6 pushed to an empty remote:", pushed == "first", repr(note(page)))
    btn(page, "Fetch", 2.0)
    check("6 fetch fine:", "failed" not in note(page), repr(note(page)))
    btn(page, "Pull", 2.0)
    check("6 pull fine:", "failed" not in note(page), repr(note(page)))
    for e in errs: print("!!", e[:300])
    assert not errs
    b.close()
