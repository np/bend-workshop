# Following an agent session: the live conversation, its count (tokens when
# the API gives them), the sessions kept across a reload, reading one back,
# exporting it, deleting it.
import os, time, json, tempfile
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, GET, OPTIONS"}
n = {"k": 0}
def anthropic(route):
    if route.request.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    if route.request.method == "GET": return route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"data": [{"id": "claude-x"}]}))
    k = n["k"]; n["k"] += 1
    content = [{"type": "text", "text": "Checking first."}, {"type": "tool_use", "id": "t1", "name": "check", "input": {}}] if k == 0 else \
              [{"type": "tool_use", "id": "t2", "name": "fill_hole", "input": {"hole": "base", "code": "{==}"}}] if k == 1 else \
              [{"type": "text", "text": "Filled.\nSTATUS: done"}]
    route.fulfill(status=200, content_type="application/json", headers=CORS,
                  body=json.dumps({"content": content, "usage": {"input_tokens": 1200 + k, "output_tokens": 40, "cache_read_input_tokens": 800}}))
PROOF = "import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}\n      {==}\n"
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 780}, locale="en-US", is_mobile=True, has_touch=True, accept_downloads=True)
    ctx.route("https://api.anthropic.com/**", anthropic)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4)
    page.locator(".ai-box select").nth(1).select_option("anthropic"); time.sleep(0.3)
    page.locator(".ai-rows input[type=password]").fill("sk-x"); time.sleep(0.8); page.click(".sheet-head button")
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", PROOF)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); page.evaluate("document.querySelector('#ed-ta').blur()")
    page.click("#chev"); time.sleep(0.2); page.locator(".tab[data-tab=agent]").scroll_into_view_if_needed(); page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.5)
    print("1 stats:", page.inner_text(".conv-stats"))
    page.locator(".agent-modes .chip", has_text="Conversation").click(); time.sleep(0.3)
    heads = [x for x in page.locator(".cv-head").all_inner_texts()]
    print("2 conversation:", len(heads), "events |", [h.split("  ")[-1][:40] for h in heads][:9])
    page.locator(".cv-fold > summary", has_text="System").first.click(); time.sleep(0.2)
    sys = page.locator(".cv-fold[open]").first
    secs = sys.locator(".cv-brief > .cv-fold > summary").all_inner_texts()
    sys.locator(".cv-brief > .cv-fold > summary", has_text="Rules").click(); time.sleep(0.2)
    print("3 system fold:", [x.split(",")[0] for x in secs], "| no task:", not any(x.startswith("Task") for x in secs),
          "| has rules:", "agent at work" in sys.locator(".cv-brief .cv-pre").first.inner_text())
    # the tools one by one, the messages as cards, the files with their lines numbered
    page.locator(".cv-fold > summary", has_text="Tools offered").first.click(); time.sleep(0.2)
    print("3b tools:", page.locator(".cv-fold > summary", has_text="fill_hole(hole, code)").count() > 0,
          "| cards:", page.locator(".cv-msg").count(), "| calls:", page.locator(".cv-msg .cv-call-head").all_inner_texts()[:3])
    page.locator(".cv-fold > summary", has_text="Files (").first.click(); time.sleep(0.2)
    page.locator(".cv-file > summary").first.click(); time.sleep(0.2)
    print("3c file:", page.locator(".cv-file").first.locator("summary").inner_text(), "| numbered:", page.locator(".cv-file .cv-gut").first.inner_text().split("\n")[:3],
          "| highlighted:", page.locator(".cv-file .cv-src .tk-kw").count() > 0)
    page.screenshot(path=shot("shot_conv_rich.png"), full_page=True)
    ends = page.locator(".cv.note").last
    print("3d end:", ends.locator(".cv-fold > summary").first.inner_text())
    page.screenshot(path=shot("shot_conv.png"))
    # kept across a reload
    page.reload(); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1)
    page.click("#chev"); time.sleep(0.2); page.click(".tab[data-tab=agent]"); time.sleep(0.8)
    page.locator(".ses-list > summary").click(); time.sleep(0.3)
    rows = page.locator(".ses-row").all_inner_texts()
    print("4 after reload:", page.inner_text(".ses-list > summary"), "|", [r.replace("\n", " ")[:70] for r in rows])
    page.locator(".ses-row").first.click(); time.sleep(0.4)
    print("5 reading:", page.inner_text(".agent-run")[:60].replace("\n", " "), "| journal:", page.locator(".ag-tool").count(), "tools")
    page.locator(".agent-modes .chip", has_text="Conversation").click(); time.sleep(0.3)
    print("5 conversation:", page.locator(".cv-head").count(), "events | stats:", page.inner_text(".conv-stats"))
    with page.expect_download() as dl:
        page.click(".agent-export .chip:has-text('.json')")
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
    print("6 export of a past session:", dl.value.suggested_filename, len(json.load(open(path))["events"]), "events")
    page.click(".agent-run .btn:has-text('Delete')"); time.sleep(0.6)
    page.locator(".ses-list > summary").click(); time.sleep(0.3)
    print("7 after delete:", page.inner_text(".ses-list > summary"))
    for e in errs: print("!!", e[:200])
    b.close()
