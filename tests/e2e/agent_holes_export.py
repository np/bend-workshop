import time, json, os, tempfile
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
MOCK = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_claude.py")).read().split('MOCK = """', 1)[1].split('"""', 1)[0]
MAIN = "import Base\nimport ./lib.bend as L\n\n# a comment with ?nothere in it\ndef f(n: Nat) -> Nat:\n  match n:\n    case 0n:\n      ?zero\n    case 1n+p:\n      ?TODO\n\ndef g(b: Bool) -> Nat:\n  match b:\n    case True{}:\n      ?twice\n    case False{}:\n      ?twice\n"
LIB = "import Base\n\ndef h(x: U32) -> U32:\n  ?inlib\n\ndef bad() -> U32:\n  \"oops\"\n\ndef later() -> U32:\n  ?behind\n"
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, GET, OPTIONS"}
n = {"k": 0}
def anthropic(route):
    if route.request.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    if route.request.method == "GET": return route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"data": [{"id": "claude-sonnet-4-6"}]}))
    k = n["k"]; n["k"] += 1
    content = [{"type": "tool_use", "id": "t1", "name": "list_holes", "input": {}}] if k == 0 else [{"type": "text", "text": "Listed.\nSTATUS: done"}]
    route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"content": content}))
def files_seed(page):
    page.evaluate("""([main, lib]) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, main); }""", [MAIN, LIB])
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US", accept_downloads=True)
    ctx.route("https://api.anthropic.com/**", anthropic)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(MOCK)
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4); page.click(".sheet-head button")
    files_seed(page)
    page.click(".file-add"); page.fill(".form input[type=text]", "lib.bend"); page.click("text=Create the file"); time.sleep(0.4)
    page.evaluate("""(lib) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, lib); }""", LIB); time.sleep(0.6)
    page.locator(".file", has_text="main.bend").click(); time.sleep(0.8)
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.locator(".agent-files .chip", has_text="lib.bend").click(); time.sleep(0.2)
    page.evaluate("""window.__plan = [[['list_holes', {}]]]""")
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.4)
    out = page.evaluate("window.__seen")[0]["log"][0]
    res = json.loads(page.evaluate("JSON.stringify(window.__lastTrace = null)") or "null") if False else None
    print("1 list_holes (project mode):", out[:120])
    # read the full result from the trace through the JSON export
    with page.expect_download() as dl:
        page.click(".agent-export .chip:has-text('.json')")
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
    data = json.load(open(path))
    ev = data["events"]
    print("2 json:", dl.value.suggested_filename, "| format:", data["format"], "| events:", [e["type"] for e in ev])
    holes = json.loads([e for e in ev if e["type"] == "tool_result"][0]["result"])["holes"]
    for h in holes:
        print("   ", h["hole"], h["file"], "l." + str(h["line"]), "in", h["in"], "| fillable:", h["fillable"], "|", h.get("why_not") or "", "| goal:", h.get("goal"), "|", (h.get("unreached") or "")[:70])
    with page.expect_download() as dl:
        page.click(".agent-export .chip:has-text('.md')")
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
    md = open(path).read()
    print("3 md:", dl.value.suggested_filename, len(md), "chars | headings:", [l for l in md.split("\n") if l.startswith("#")][:12])
    # 4. an API session: the key never appears in the export
    page.click(".agent-end .btn:has-text('New session')"); time.sleep(0.3)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4)
    page.locator(".ai-box select").nth(1).select_option("anthropic"); time.sleep(0.4)
    page.locator(".ai-rows input[type=password]").fill("sk-SECRET-123"); time.sleep(0.8); page.click(".sheet-head button"); time.sleep(0.3)
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.locator(".agent-grid select").nth(1).select_option(label="Profile 2")
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.4)
    with page.expect_download() as dl:
        page.click(".agent-export .chip:has-text('.json')")
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
    raw = open(path).read(); data = json.loads(raw)
    print("4 api events:", [e["type"] for e in data["events"]], "| key in export:", "sk-SECRET" in raw,
          "| round 1 has system+tools:", "system" in [e for e in data["events"] if e["type"] == "api_request"][0])
    with page.expect_download() as dl:
        page.click(".agent-export .chip:has-text('.md')")
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
    print("4 md key:", "sk-SECRET" in open(path).read())
    # 5. project export as .json
    page.click("#btn-proj")
    with page.expect_download() as dl:
        page.click(".sheet .btn:has-text('Export as .json')")
    print("5 project json:", dl.value.suggested_filename)
    for e in errs: print("!!", e[:200])
    b.close()
