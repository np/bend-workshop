# The agent's memory with two tabs on one project: a session in each, one
# after the other, while both keep the memory loaded; neither tab's
# messages are lost, after a reload too. Then a database read that fails:
# the session goes on, and what it says is stored after what was there.
import os, time, json
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
MOCK = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_claude.py")).read().split('MOCK = """', 1)[1].split('"""', 1)[0]
READ = """async () => new Promise((done) => { const r = indexedDB.open('bend-workshop'); r.onsuccess = () => {
  const tx = r.result.transaction('chats', 'readonly'); const q = tx.objectStore('chats').getAll();
  q.onsuccess = () => { const all = q.result; r.result.close(); done(all.map(x => ({ id: x.id, rev: x.rev, msgs: x.msgs.map(m => m.text) }))); }; }; })"""
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *[str(m)[:600] for m in more])
def start(page, task):
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.evaluate("window.__plan = [[['list_files', {}]]]")
    if page.locator(".agent-end .btn:has-text('New session')").count():
        page.click(".agent-end .btn:has-text('New session')"); time.sleep(0.3)
    page.fill(".agent-form textarea", task)
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(1.0)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
    ctx.add_init_script(MOCK)
    errs = []
    a = ctx.new_page(); a.on("pageerror", lambda e: errs.append(str(e)))
    a.goto("http://localhost:8123/index.html"); a.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    a.click("#btn-settings"); a.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4); a.click(".sheet-head button")
    start(a, "Task from tab A, first.")
    bb = ctx.new_page(); bb.on("pageerror", lambda e: errs.append(str(e)))
    bb.goto("http://localhost:8123/index.html"); bb.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    start(bb, "Task from tab B.")
    start(a, "Task from tab A, second.")
    time.sleep(1.0)
    rows = a.evaluate(READ)
    texts = rows[0]["msgs"] if rows else []
    check("both tabs' tasks stored", all(t in texts for t in ["Task from tab A, first.", "Task from tab B.", "Task from tab A, second."]), [x for x in texts if x.startswith("Task")])
    check("in order", [x for x in texts if x.startswith("Task")] == ["Task from tab A, first.", "Task from tab B.", "Task from tab A, second."])
    bb.close()
    a.reload(); a.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    a.click(".tab[data-tab=agent]"); time.sleep(0.5)
    a.locator(".agent-modes .chip", has_text="Memory").click(); time.sleep(0.5)
    view = a.inner_text("#pane-agent")
    check("after a reload, the Memory view has all three", all(t in view for t in ["tab A, first", "tab B", "tab A, second"]), view[:500])
    # a read that fails (the database out of reach): the session's messages are kept and merged later
    a.reload(); a.wait_for_selector("#verdict", timeout=30000); time.sleep(1.0)
    a.evaluate("""() => { const real = IDBObjectStore.prototype.get; let n = 0;
      IDBObjectStore.prototype.get = function (k) { if (this.name === 'chats' && n++ === 0) throw new Error('out of reach'); return real.call(this, k); }; }""")
    start(a, "Task while the database failed.")
    time.sleep(1.5)
    rows = a.evaluate(READ)
    texts = rows[0]["msgs"] if rows else []
    check("a failed read: nothing lost, the new task after the old", [x for x in texts if x.startswith("Task")] == ["Task from tab A, first.", "Task from tab B.", "Task from tab A, second.", "Task while the database failed."], [x for x in texts if x.startswith("Task")])
    for e in errs: print("!!", e[:300])
    b.close()
