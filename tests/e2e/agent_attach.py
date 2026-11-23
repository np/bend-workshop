# Documents: uploaded into the project (the files' + sheet; a binary
# refused), edited in the editor (plain, never checked), attached to the
# agent's request (whole in its prompt), locked to it until unlocked, then
# written by it; uploaded from the agent's form, attached at once; in the
# zip, and in git's changes.
import os, time, json, tempfile, zipfile
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
MOCK = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_claude.py")).read().split('MOCK = """', 1)[1].split('"""', 1)[0]
MOCK = MOCK.replace(".slice(0, 220)", ".slice(0, 3000)").replace("window.__sizes.push(input.length);", "window.__sizes.push(input.length); (window.__inputs = window.__inputs || []).push(input);")
d = tempfile.mkdtemp()
open(os.path.join(d, "spec.md"), "w").write("# Spec\n\n- double(n) is n + n\n")
open(os.path.join(d, "notes.txt"), "w").write("remember: U32 wraps\n")
open(os.path.join(d, "pic.png"), "wb").write(bytes([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2]))
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *[str(m)[:300] for m in more])
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US", accept_downloads=True)
    ctx.add_init_script(MOCK)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", "import Base\n\ndef double(+n: Nat) -> Nat:\n  Nat.add(n, n)\n")
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    # 1 upload: a document and a binary (refused)
    page.click(".file-add"); time.sleep(0.3)
    with page.expect_file_chooser() as fc:
        page.locator(".sheet .btn", has_text="Upload files").click()
    fc.value.set_files([os.path.join(d, "spec.md"), os.path.join(d, "pic.png")]); time.sleep(1.0)
    files = [x.strip() for x in page.locator(".file").all_inner_texts()]
    check("1 spec.md in the project, the binary refused", any("spec.md" in f for f in files) and not any("pic" in f for f in files)
          and "Not text" in page.inner_text("#status"), files, page.inner_text("#status"))
    code = page.evaluate("document.querySelector('#ed-ta').value")
    check("1 spec.md open, editable, shown plain", code.startswith("# Spec") and page.locator("#ed-hl .tk-kw, #ed-hl .tk-def").count() == 0)
    page.evaluate("""() => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); document.execCommand('insertText', false, '- triple later\\n'); }"""); time.sleep(0.8)
    # 2 the agent: attach spec.md; locked to it
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4); page.click(".sheet-head button")
    page.locator(".file", has_text="main.bend").click(); time.sleep(0.4)
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.locator(".agent .chip", has_text="The project").click(); time.sleep(0.2)
    lock = page.locator(".agent-files .chip", has_text="spec.md").inner_text()
    check("2 a document is locked by default", "🔒" in lock, lock)
    page.locator(".agent-attach label", has_text="spec.md").locator("input").check(); time.sleep(0.2)
    page.evaluate("""window.__plan = [[['edit_file', {path: 'spec.md', old_text: '- triple later', new_text: '- triple(n) is n + n + n'}], ['list_files', {}]]]""")
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.4)
    log = page.evaluate("window.__seen")[0]["log"]
    prompt = page.evaluate("window.__inputs[0]")
    check("2 the spec whole in the prompt, with the edit typed", "<attached>" in prompt and "- double(n) is n + n" in prompt and "- triple later" in prompt, prompt[prompt.find("<attached>"):][:200])
    check("2 the agent may not write it yet", "not open to you" in log[0], log[0])
    check("2 list_files marks it a document, attached", '"document": true' in log[1] and '"attached": true' in log[1], log[1][:300])
    # 3 unlocked: the agent updates the spec
    page.click(".agent-end .btn:has-text('New session')"); time.sleep(0.3)
    page.locator(".agent-files .chip", has_text="spec.md").click(); time.sleep(0.2)
    check("3 unlocked", "🔓" in page.locator(".agent-files .chip", has_text="spec.md").inner_text())
    page.evaluate("""window.__plan = [[['edit_file', {path: 'spec.md', old_text: '- triple later', new_text: '- triple(n) is n + n + n'}]]]; window.__seen = []""")
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.4)
    log = page.evaluate("window.__seen")[0]["log"]
    spec = page.evaluate("JSON.parse(localStorage.getItem('bend-play:p:' + JSON.parse(localStorage.getItem('bend-play:v2')).current)).files.find(f => f.name === 'spec.md').text")
    check("3 the agent wrote the spec", "Error" not in log[0] and "triple(n) is n + n + n" in spec, log[0][:120], spec)
    # 4 an upload from the agent's form is attached at once
    page.click(".agent-end .btn:has-text('New session')"); time.sleep(0.3)
    with page.expect_file_chooser() as fc:
        page.locator(".agent .btn", has_text="Upload documents").click()
    fc.value.set_files(os.path.join(d, "notes.txt")); time.sleep(0.8)
    check("4 notes.txt attached", page.locator(".agent-attach label", has_text="notes.txt").locator("input").is_checked())
    # 5 the zip holds the documents; git sees them
    page.click("#btn-proj")
    with page.expect_download() as dl:
        page.click("text=Export as .zip")
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
    names = zipfile.ZipFile(path).namelist()
    check("5 the zip holds spec.md and notes.txt", any(n.endswith("/spec.md") for n in names) and any(n.endswith("/notes.txt") for n in names), names)
    page.click("#btn-proj"); time.sleep(0.2)
    page.locator(".sheet .btn", has_text="Git…").click(); time.sleep(0.8)
    page.locator(".git .btn", has_text="Create a repository").click(); time.sleep(1.5)
    ch = page.inner_text(".git-changes")
    check("5 git: the documents among the changes", "spec.md" in ch and "notes.txt" in ch, ch)
    page.click(".sheet-head button"); time.sleep(0.2)
    # 6 the zip imported back brings the documents
    page.evaluate("localStorage.clear()"); page.evaluate("indexedDB.deleteDatabase('bend-workshop')")
    page.reload(); page.wait_for_selector("#verdict", timeout=30000); time.sleep(0.8)
    page.click("#btn-proj")
    with page.expect_file_chooser() as fc:
        page.click("text=Import…")
    fc.value.set_files(path); time.sleep(1.5)
    files = [x.strip() for x in page.locator(".file").all_inner_texts()]
    check("6 imported: the documents are back", any("spec.md" in f for f in files) and any("notes.txt" in f for f in files), files)
    for e in errs: print("!!", e[:300])
    b.close()
