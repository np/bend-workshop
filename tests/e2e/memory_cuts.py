# Memory lines cut while the summaries' model did not answer (an older
# page cut them and counted them as summaries): the Memory view finds them,
# says the messages under them are whole, and rewrites them through the
# summaries' model (Claude's quick tier here); none left after.
import os, time, json
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
MOCK = """window.__asked = []; window.claude = { use: async (n) => n === 'sample' ? Object.assign(async (input, opts) => {
  window.__asked.push(opts && opts.modelTier); return { text: 'A real summary, line ' + window.__asked.length, truncated: false }; },
  { limits: async () => ({ tools: { maxCount: 16 }, maxPromptBytes: 262144 }), json: async () => ({}) }) : null };"""
def cut(a, b):
    s = a + " ⁞ " + b
    half = (512 - 5) // 2
    return s[:half] + " … " + s[-half:]
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *[str(m)[:300] for m in more])
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(MOCK)
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4); page.click(".sheet-head button")
    msgs = [{"kind": "tool", "text": ("message %d " % i) + "m" * 700, "t": 1} for i in range(4)]
    rec = {"msgs": msgs, "nodes": {"1,0": cut("tool: message 0 " + "m" * 480, "tool: message 1 " + "m" * 480), "1,1": cut("tool: message 2 " + "m" * 480, "tool: message 3 " + "m" * 480)},
           "view": [[1, 0], [1, 1]], "made": 300, "rev": 1}
    page.evaluate("""async (rec) => { const pid = JSON.parse(localStorage.getItem('bend-play:v2')).current;
      await new Promise((done) => { const r = indexedDB.open('bend-workshop', 3);
        r.onupgradeneeded = () => { for (const n of ['sessions', 'chats', 'git']) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, { keyPath: 'id' }); };
        r.onsuccess = () => { const tx = r.result.transaction('chats', 'readwrite'); tx.objectStore('chats').put(Object.assign({ id: pid }, rec)); tx.oncomplete = () => { r.result.close(); done(); }; }; }); }""", rec)
    page.reload(); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1)
    page.click(".tab[data-tab=agent]"); time.sleep(0.5)
    page.locator(".agent-modes .chip", has_text="Memory").click(); time.sleep(0.5)
    note = page.inner_text(".mem-cuts") if page.locator(".mem-cuts").count() else ""
    check("the cuts are found, the messages said whole", "2 lines of the memory are cuts" in note and "whole" in note, note)
    page.locator(".mem-cuts .btn", has_text="Rewrite 2 lines").click()
    for _ in range(40):
        if page.locator(".mem-cuts").count() == 0: break
        time.sleep(0.25)
    check("rewritten through the quick tier, none left", page.locator(".mem-cuts").count() == 0 and page.evaluate("window.__asked") == ["quick", "quick"], page.evaluate("window.__asked"))
    view = page.inner_text("#pane-agent")
    check("the view shows the summaries", "A real summary, line 1" in view and "A real summary, line 2" in view)
    time.sleep(0.6)
    stored = page.evaluate("""async () => { const pid = JSON.parse(localStorage.getItem('bend-play:v2')).current;
      return await new Promise((done) => { const r = indexedDB.open('bend-workshop'); r.onsuccess = () => { const q = r.result.transaction('chats', 'readonly').objectStore('chats').get(pid);
        q.onsuccess = () => { r.result.close(); done(q.result.nodes); }; }; }); }""")
    check("stored", stored["1,0"].startswith("A real summary") and stored["1,1"].startswith("A real summary"), stored)
    for e in errs: print("!!", e[:300])
    b.close()
