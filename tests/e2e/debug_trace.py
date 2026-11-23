# Debug.trace: the files' + sheet adds debug.bend and its import; a run
# prints "trace: ..." in order, the value unchanged; the program the run
# hands the worker holds the debugger statement and names its source
# (bend-program.js); the Compiled tab stays the CLI's output.
import time
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
PROG = "import Base\n\ndef fact(+n: Nat) -> Nat:\n  match n:\n    case 0n: 1n\n    case 1n+p: Debug.trace(Nat, \"fact \" ++ Nat.show(p), Nat.add(p, fact(p)))\n\ndef main() -> Nat:\n  fact(3n)\n"
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *[repr(m)[:400] for m in more])
with sync_playwright() as p:
    b = p.chromium.launch()
    for label, init in [("worker", ""), ("page", "delete window.Worker;")]:
        page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        # what the run hands the worker (or the page), kept to look at
        page.add_init_script(init + """window.__srcs = []; const B = window.Blob; window.Blob = function (parts, o) { try { window.__srcs.push(parts.join('')); } catch (e) {} return new B(parts, o); };
          const F = window.Function; window.Function = function (...a) { window.__srcs.push(a[a.length - 1]); return F(...a); };""")
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
        page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", PROG)
        time.sleep(0.8)
        page.click(".file-add"); time.sleep(0.3)
        page.locator(".sheet .btn", has_text="Add debug.bend").click(); time.sleep(1.5)
        code = page.evaluate("document.querySelector('#ed-ta').value")
        files = [x.strip() for x in page.locator(".file").all_inner_texts()]
        check(label + ": debug.bend added, its import too", any("debug.bend" in f for f in files) and "import ./debug.bend as Debug" in code, files, code[:80])
        page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
        page.click("#run")
        for _ in range(60):
            log = page.locator("#log").inner_text()
            if "exit code" in log or "ran in" in log: break
            time.sleep(0.25)
        lines = [l for l in page.locator("#log").inner_text().split("\n") if l.strip()]
        traces = [l for l in lines if l.startswith("trace:")]
        check(label + ": traces in order, innermost first (strict)", traces == ["trace: fact 0", "trace: fact 1", "trace: fact 2"], traces)
        check(label + ": the value unchanged (0+1, 1+1, 2+2)", "4n" in lines, lines[-4:])
        srcs = page.evaluate("window.__srcs.filter(s => s.includes('bend-program.js'))")
        check(label + ": the run's source holds the debugger statement", len(srcs) > 0 and "debugger; // Debug.trace" in srcs[-1] and "__bend_trace(_msg_0)" in srcs[-1])
        for e in errs: print("!!", e[:200])
        page.close()
    b.close()
