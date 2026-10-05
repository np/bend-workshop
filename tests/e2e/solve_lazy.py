import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def code(page): return page.evaluate("document.querySelector('#ed-ta').value")
def heads(page): return [c.locator(".goal-head .chip").all_inner_texts() for c in page.locator(".goal").all()]
with sync_playwright() as p:
    b = p.chromium.launch()
    for locale in ["en-US", "fr-FR"]:
        page = b.new_context(viewport={"width": 1280, "height": 800}, locale=locale).new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
        set_code(page, "import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      ?step\n\ndef m() -> Maybe<Nat>:\n  ?m\n\ndef u() -> Unit:\n  ?u\n")
        page.wait_for_selector("#verdict[data-state=goal]", timeout=30000)
        solve = "Résoudre" if locale.startswith("fr") else "Solve"
        page.wait_for_function("(s) => [...document.querySelectorAll('.goal-head .chip')].filter(x => x.textContent === s).length >= 2", arg=solve, timeout=15000)
        time.sleep(0.5)
        print("==", locale, "heads:", heads(page))
        # Solve on ?base puts {==}; ?step keeps Constructors (its {==} does not type)
        page.locator(".goal").nth(0).locator(".chip", has_text=solve).click(); time.sleep(1.0)
        page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.0)
        print("   after solve:", repr(code(page).split("case 0n:\n")[1][:10]), "| heads:", heads(page))
        page.locator(".goal", has_text="?u").locator(".chip", has_text=solve).click(); time.sleep(1.0)
        print("   unit solved:", repr(code(page).split("-> Unit:\n")[1][:8]))
        if locale.startswith("en"): page.screenshot(path=shot("shot_f9.png"))
        for e in errs: print("!!", e[:200])
        page.close()
    # a slow file keeps the lazy button: pure_par_sort's PROOF with a hole
    import os, json
    root = "../bend/demos/proof_insertion_sort"
    files = [{"name": n, "text": open(root + "/" + n).read()} for n in sorted(os.listdir(root)) if n.endswith(".bend")]
    proof = [f for f in files if f["name"] == "PROOF.bend"][0]
    lines = proof["text"].split("\n"); idx = max(i for i, l in enumerate(lines) if l.strip() == "{==}"); lines[idx] = lines[idx].replace("{==}", "?ici"); proof["text"] = "\n".join(lines)
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    page.add_init_script("if (!localStorage.getItem('seed')) { localStorage.setItem('seed', '1'); localStorage.setItem('bend-play:v2', " + json.dumps(json.dumps({"current": "x", "order": ["x"], "live": True, "size": 14, "lang": "en"})) + "); localStorage.setItem('bend-play:p:x', " + json.dumps(json.dumps({"id": "x", "name": "sort", "files": files, "active": 1, "args": ""})) + "); }")
    page.goto("http://localhost:8123/index.html?probe_ms=1")
    page.wait_for_selector("#verdict[data-state=goal]", timeout=60000); time.sleep(2.0)
    lazy = page.locator(".goal").first.locator(".chip.lazy")
    print("== slow file:", page.inner_text("#verdict-text")[:30], "| heads:", heads(page), "| lazy:", lazy.count(), lazy.get_attribute("aria-label")[:40] if lazy.count() else "")
    lazy.click()
    page.wait_for_function("() => { const h = document.querySelector('.goal .goal-head'); return h && !h.textContent.includes('…'); }", timeout=60000)
    time.sleep(0.3)
    print("   after forced try:", heads(page), "| list open:", page.locator(".goal .cands").count())
    b.close()
