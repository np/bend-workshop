# Git in the page: a repository per project (create, commit, diff, check
# out with Undo, branches), its .git in the zip and back; then a remote:
# clone, push (a login refused, then given), pull; a host that refuses
# pages, reached through a CORS proxy.
import time, os, tempfile, zipfile, subprocess
from playwright.sync_api import sync_playwright
from serve import serve, shot
from git_server import serve_git, serve_proxy, make_repo
serve("dist", 8123)
ROOT = tempfile.mkdtemp()
make_repo(ROOT, "seed.git", {"main.bend": "import Base\n\ndef main() -> Nat:\n  1n\n", "README.md": "# seed\n"})
serve_git(8130, ROOT, cors=True, login="tester:secret")
serve_git(8132, ROOT, cors=False)
serve_proxy(8133)
A = "import Base\n\ndef main() -> Nat:\n  1n\n"
B = "import Base\n\ndef main() -> Nat:\n  2n\n"
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000); time.sleep(0.3)
def code(page): return page.evaluate("document.querySelector('#ed-ta').value")
def git_sheet(page):
    if page.locator(".sheet").count(): page.click(".sheet-head button"); time.sleep(0.2)
    page.click("#btn-proj"); time.sleep(0.2)
    page.locator(".sheet .btn", has_text="Git…").click(); time.sleep(0.8)
def note(page): return page.inner_text(".git-note") if page.locator(".git-note").count() else ""
def wait_note_clear(page, t=20):
    for _ in range(t * 5):
        if page.locator(".git-note").count() and not page.inner_text(".git-note").strip(): return
        time.sleep(0.2)
def commit(page, msg):
    page.fill(".git input[placeholder='What changed']", msg)
    page.locator(".git .btn", has_text="Commit").click(); time.sleep(0.6); wait_note_clear(page)
def settings_git(page, **kv):
    page.click("#btn-settings"); time.sleep(0.3)
    page.click(".git-settings > summary"); time.sleep(0.2)
    for label, value in kv.items():
        i = page.locator(".git-rows label", has_text=label).locator("input")
        i.fill(value); i.dispatch_event("change")
    time.sleep(0.2); page.click(".sheet-head button"); time.sleep(0.2)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, locale="en-US", accept_downloads=True)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(0.8)
    set_code(page, A)
    # 1 a repository, two commits
    git_sheet(page)
    page.locator(".git .btn", has_text="Create a repository").click(); time.sleep(1.5)
    check("1 created:", "main" in page.inner_text(".git-head"), "1 file changed" in page.inner_text(".git"))
    commit(page, "first")
    check("1 committed:", "No change" in page.inner_text(".git"), "first" in page.inner_text(".git-log"))
    page.click(".sheet-head button"); set_code(page, B); git_sheet(page)
    check("1 a change seen:", "1 file changed" in page.inner_text(".git"))
    page.locator(".git-changes .chip", has_text="main.bend").click(); time.sleep(0.8)
    check("1 its diff before the commit:", "+   2n" in page.locator(".diff .add").all_inner_texts(), "-   1n" in page.locator(".diff .del").all_inner_texts())
    page.locator(".sheet-head button").last.click(); time.sleep(0.3)
    commit(page, "second")
    check("1 two commits:", page.locator(".git-commit").count() == 2)
    # 2 the diff of the last commit
    page.locator(".git-commit").first.locator("button", has_text="Diff").click(); time.sleep(0.8)
    check("2 diff:", page.locator(".diff .del").all_inner_texts(), "-   1n" in page.locator(".diff .del").all_inner_texts(), "+   2n" in page.locator(".diff .add").all_inner_texts())
    page.screenshot(path=shot("shot_git_diff.png"))
    # 3 check out the first, then Undo
    git_sheet(page)
    page.locator(".git-commit").last.locator("button", has_text="Check out").click(); time.sleep(1.2)
    check("3 checked out:", code(page) == A)
    page.locator(".toast button", has_text="Undo").first.click(); time.sleep(0.5)
    page.click(".sheet-head button"); time.sleep(0.2)
    check("3 undo:", code(page) == B)
    # 4 a branch
    git_sheet(page)
    page.locator(".git-commit").first.locator("button", has_text="Check out").click(); time.sleep(1.0)
    page.fill(".git input[placeholder='new-branch']", "side")
    page.locator(".git .btn", has_text="Create and switch").click(); time.sleep(0.8); wait_note_clear(page)
    page.click(".sheet-head button"); set_code(page, A.replace("1n", "3n")); git_sheet(page)
    commit(page, "on side")
    page.locator(".git-branches .chip", has_text="main").click(); time.sleep(1.2)
    check("4 branch main again:", code(page) == B, "main" in page.inner_text(".git-head"))
    page.screenshot(path=shot("shot_git.png"))
    # 5 the zip holds .git, and brings it back
    page.click(".sheet-head button"); page.click("#btn-proj")
    with page.expect_download() as dl:
        page.click("text=Export as .zip")
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
    names = zipfile.ZipFile(path).namelist()
    check("5 .git in the zip:", any("/.git/HEAD" in n for n in names), sum(1 for n in names if "/.git/objects/" in n) > 3)
    # unzipped, real git reads it
    out = tempfile.mkdtemp(); zipfile.ZipFile(path).extractall(out)
    top = os.path.join(out, os.listdir(out)[0])
    log = subprocess.run(["git", "log", "--all", "--format=%s"], cwd=top, capture_output=True, text=True).stdout.split()
    check("5 git log on the unzipped folder:", log, "second" in log and "first" in log)
    page.evaluate("localStorage.clear()"); page.evaluate("indexedDB.deleteDatabase('bend-workshop')")
    page.reload(); page.wait_for_selector("#verdict", timeout=30000); time.sleep(0.8)
    page.click("#btn-proj")
    with page.expect_file_chooser() as fc:
        page.click("text=Import…")
    fc.value.set_files(path); time.sleep(1.5)
    git_sheet(page)
    check("5 imported with its history:", page.locator(".git-commit").count() == 2, "No change" in page.inner_text(".git"))
    page.click(".sheet-head button")
    # 6 clone, push refused, then with credentials, pull
    git_sheet(page)
    page.click(".sheet-head button")
    page.click("#btn-examples"); page.locator(".ex").first.click(); time.sleep(1.0)
    git_sheet(page)
    page.fill(".git input[aria-label='Repository URL']", "http://127.0.0.1:8130/seed.git")
    page.locator(".git .btn", has_text="Clone").click()
    page.wait_for_function("document.querySelector('#proj-name').textContent === 'seed'", timeout=30000); time.sleep(0.8)
    check("6 cloned:", code(page) == A, page.locator(".file").count() == 1)
    set_code(page, B); git_sheet(page)
    commit(page, "from the page")
    page.locator(".git .btn", has_text="Push").click(); time.sleep(2.0)
    check("6 push without login refused:", "failed" in note(page), note(page)[:80])
    page.click(".sheet-head button")
    settings_git(page, **{"Host": "127.0.0.1:8130", "User name": "tester", "Token or password": "secret"})
    git_sheet(page)
    page.locator(".git .btn", has_text="Push").click(); time.sleep(2.0); wait_note_clear(page)
    srv = subprocess.run(["git", "log", "--format=%s", "main"], cwd=os.path.join(ROOT, "seed.git"), capture_output=True, text=True).stdout.split("\n")
    tree = subprocess.run(["git", "ls-tree", "--name-only", "main"], cwd=os.path.join(ROOT, "seed.git"), capture_output=True, text=True).stdout.split()
    check("6 pushed:", srv[0] == "from the page", "README.md" in tree)
    # the server gets a commit; pull
    w = tempfile.mkdtemp()
    subprocess.run(["git", "clone", "-q", os.path.join(ROOT, "seed.git"), w], check=True)
    open(os.path.join(w, "main.bend"), "w").write(A.replace("1n", "4n"))
    subprocess.run(["git", "-c", "user.name=S", "-c", "user.email=s@x", "commit", "-qam", "server side"], cwd=w, check=True)
    subprocess.run(["git", "push", "-q", "origin", "main"], cwd=w, check=True)
    page.locator(".git .btn", has_text="Pull").click(); time.sleep(2.0)
    check("6 pulled:", "4n" in code(page), note(page)[:80])
    page.click(".sheet-head button") if page.locator(".sheet").count() else None
    # 7 a host refusing pages: through the proxy
    git_sheet(page); page.click(".sheet-head button")
    page.click("#btn-examples"); page.locator(".ex").first.click(); time.sleep(1.0)
    git_sheet(page)
    page.fill(".git input[aria-label='Repository URL']", "http://127.0.0.1:8132/seed.git")
    page.locator(".git .btn", has_text="Clone").click(); time.sleep(3.0)
    refused = page.locator(".sheet").count() == 1 and "failed" in page.inner_text(".git")
    check("7 no proxy, refused:", refused)
    page.click(".sheet-head button")
    settings_git(page, **{"CORS proxy": "http://127.0.0.1:8133"})
    git_sheet(page)
    page.fill(".git input[aria-label='Repository URL']", "http://127.0.0.1:8132/seed.git")
    page.locator(".git .btn", has_text="Clone").click()
    page.wait_for_function("document.querySelector('#proj-name').textContent.startsWith('seed')", timeout=30000); time.sleep(0.8)
    check("7 through the proxy:", "4n" in code(page))
    for e in errs: print("!!", e[:300])
    assert not errs
    b.close()
