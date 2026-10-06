# Taking an agent session up again: a session ends on an error (the API
# overloaded), the user changes the settings (holes only, each fill must
# close its goal, another budget) and says what to do now; the session goes
# on with a fresh brief that carries why it stopped and the user's words.
# One session in the end: one journal, one trace, one past session, which
# can itself be taken up again after a reload.
import os, time, json, tempfile
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, GET, OPTIONS"}
n = {"k": 0}
bodies = []
def anthropic(route):
    if route.request.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    if route.request.method == "GET": return route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"data": [{"id": "claude-x"}]}))
    k = n["k"]; n["k"] += 1
    bodies.append(json.loads(route.request.post_data))
    if k == 1:
        return route.fulfill(status=529, content_type="application/json", headers=CORS, body=json.dumps({"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}))
    content = [{"type": "text", "text": "Checking first."}, {"type": "tool_use", "id": "t1", "name": "check", "input": {}}] if k == 0 else \
              [{"type": "tool_use", "id": "t2", "name": "fill_hole", "input": {"hole": "base", "code": "{==}"}}] if k == 2 else \
              [{"type": "text", "text": "Filled.\nSTATUS: done"}]
    route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"content": content}))
PROOF = "import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}\n      {==}\n"
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 360, "height": 780}, locale="en-US", is_mobile=True, has_touch=True, accept_downloads=True)
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
    print("1 first leg:", page.inner_text(".ag-err")[:60].replace("\n", " "), "| verdict:", page.inner_text(".ag-verdict"))
    assert page.locator(".agent-resume").count() == 1, "no resume form"
    print("1 resume form:", page.inner_text(".agent-resume-title"), "| buttons:", page.locator(".agent-resume .agent-end .btn").all_inner_texts())
    page.screenshot(path=shot("shot_resume_form.png"), full_page=True)
    # refine: holes only, close each goal, budget 7, and a word
    page.locator(".agent-resume .chip", has_text="Only chosen holes").click(); time.sleep(0.3)
    page.locator(".agent-resume .agent-holes label", has_text="?base").locator("input").check()
    page.locator(".agent-resume label.check input").check()
    page.fill("#agent-budget", "7")
    page.fill("#agent-note", "The API was overloaded: just fill ?base with {==}.")
    page.locator(".agent-resume .btn", has_text="Continue the session").click()
    page.wait_for_selector(".agent-resume", timeout=30000); time.sleep(0.5)
    print("2 verdicts:", page.locator(".ag-verdict").all_inner_texts())
    print("2 notes:", [x for x in page.locator(".ag-note").all_inner_texts() if "resumed" in x or "»" in x])
    second = bodies[2]
    user = second["messages"][0]["content"]
    system = second["system"][0]["text"]
    tools = [t["name"] for t in second["tools"]]
    print("3 brief:", "<resumed>" in user, "error" in user.split("<resumed>")[1][:200], "just fill ?base" in user, "| so far:", "<so_far>" in user)
    print("3 rules now:", "You may only fill these holes, with fill_hole: ?base" in system, "must close its goal" in system, "| edit_file offered:", "edit_file" in tools)
    assert "<resumed>" in user and "just fill ?base" in user and "edit_file" not in tools
    print("4 journal:", [x.replace("\n", " ") for x in page.locator(".ag-tool .ag-head").all_inner_texts()])
    page.locator(".agent-modes .chip", has_text="Conversation").click(); time.sleep(0.3)
    heads = page.locator(".cv-head").all_inner_texts()
    print("5 conversation:", len(heads), "events | resumed row:", any("Resumed with" in h for h in heads))
    with page.expect_download() as dl:
        page.click(".agent-export .chip:has-text('.md')")
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
    md = open(path).read()
    print("6 export:", "## Resumed" in md, "The API was overloaded" in md, md.count("## End"), "ends")
    page.locator(".agent-modes .chip", has_text="Journal").click(); time.sleep(0.2)
    # kept as one session, and taken up again after a reload
    page.reload(); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1)
    page.click("#chev"); time.sleep(0.2); page.click(".tab[data-tab=agent]"); time.sleep(0.8)
    page.locator(".ses-list > summary").click(); time.sleep(0.3)
    print("7 after reload:", page.inner_text(".ses-list > summary"))
    page.locator(".ses-row").first.click(); time.sleep(0.4)
    page.locator(".agent-end .btn", has_text="Continue this session").click(); time.sleep(0.4)
    print("8 taken up:", page.locator(".agent-resume").count() == 1, "| journal:", page.locator(".ag-tool").count(), "tools",
          "| mode kept:", page.locator(".agent-resume .chip.on").first.inner_text())
    page.screenshot(path=shot("shot_resume_past.png"), full_page=True)
    for e in errs: print("!!", e[:200])
    b.close()
