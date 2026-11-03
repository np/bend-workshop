# Program arguments and files: named argument sets (Settings), a data file in
# test/data read by the program, files the program writes shown as download
# links (text shown, Keep adds it to test/data), the agent's run with a set
# name and the list_args tool (text and hexdump), the zip round trip.
import os, time, json, zipfile, io, tempfile, subprocess
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
MOCK = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_claude.py")).read().split('MOCK = """', 1)[1].split('"""', 1)[0]
MOCK = MOCK.replace(".slice(0, 220)", ".slice(0, 6000)")
CODE = """import Base

def written(pair: File & Result<&1, &1, U32 & String, Unit>) -> IO(File):
  (file, result) = pair
  do IO<File>:
    IO.pass(Unit, result)
    return file

def got(pair: File & Result<&1, &1, U32 & String, String>) -> IO(String):
  (file, result) = pair
  do IO<String>:
    text : String <- IO.pass(String, result)
    File.close(file)
    return text

# IO.args: the program, then its arguments
def first(xs: List<String>) -> String:
  match xs:
    case []: "none"
    case _ <> []: "none"
    case _ <> x <> _: x

def save(+text: String) -> IO(Unit):
  do IO<Unit>:
    IO.print("read " ++ text)
    o : File <- IO.try(File, File.open("out.txt", "w"))
    q : File & Result<&1, &1, U32 & String, Unit> <- File.write(o, "copy: " ++ text)
    o : File <- written(q)
    File.close(o)
    b : File <- IO.try(File, File.open("bin.dat", "w"))
    r : File & Result<&1, &1, U32 & String, Unit> <- File.write_bytes(b, [0, 1, 2, 255])
    b : File <- written(r)
    File.close(b)

def go(+path: String) -> IO(Unit):
  do IO<Unit>:
    IO.print("reading " ++ path)
    f : File <- IO.try(File, File.open(path, "r"))
    p : File & Result<&1, &1, U32 & String, String> <- File.read(f, 100)
    text : String <- got(p)
    save(text)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    go(first(args))
"""
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *[str(m)[:400] for m in more])

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 360, "height": 740}, locale="en-US", accept_downloads=True)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(MOCK)
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", CODE); time.sleep(1.5)
    # settings: a text data file, two argument sets
    page.click("#btn-settings"); time.sleep(0.4)
    box = page.locator(".args-box")
    box.locator(".data-new summary").click()
    box.locator(".data-new input").fill("in.txt")
    box.locator(".data-new textarea").fill("hello data")
    box.locator(".data-new .btn").click(); time.sleep(0.2)
    check("data file listed", "test/data/in.txt" in box.locator(".data-files").inner_text(), box.inner_text())
    box.locator(".data-file .chip", has_text="+ args").click(); time.sleep(0.2)
    check("+ args puts the path in the line", box.locator("label input").nth(1).input_value() == "test/data/in.txt")
    box.locator(".btn", has_text="New set").click(); time.sleep(0.2)
    box.locator("label input").nth(0).fill("missing"); box.locator("label input").nth(0).dispatch_event("change"); time.sleep(0.2)
    box.locator("label input").nth(1).fill("test/data/nope.txt"); time.sleep(0.2)
    opts = page.evaluate("[...document.querySelectorAll('.args-box select option')].map(o => o.textContent)")
    check("two sets in the dropdown", opts == ["default", "missing"], opts)
    wide = page.evaluate("document.documentElement.scrollWidth")
    check("settings fit the phone", wide <= 360, wide)
    page.screenshot(path=shot("program_files_settings.png"))
    box.locator("select").select_option("0"); time.sleep(0.2)
    page.click(".sheet-head button"); time.sleep(0.3)
    # run with the default set
    page.click("#run")

    page.wait_for_selector(".out-files", timeout=60000); time.sleep(0.3)
    txt = page.locator("#log").inner_text()
    check("program read the data file", "read hello data" in txt, txt[-600:])
    links = page.evaluate("[...document.querySelectorAll('.out-file a')].map(a => [a.textContent, a.getAttribute('download')])")
    check("two download links", sorted(l[1] for l in links) == ["bin.dat", "out.txt"], links)
    with page.expect_download() as d:
        page.locator(".out-file a", has_text="out.txt").click()
    data = open(d.value.path(), "rb").read()
    check("download is the file", data == b"copy: hello data", data)
    page.locator(".out-file", has_text="out.txt").locator("summary").click()
    check("text shown", "copy: hello data" in page.locator(".out-file-text").first.inner_text())
    page.locator(".out-file", has_text="out.txt").locator(".chip").click(); time.sleep(0.3)
    page.screenshot(path=shot("program_files_run.png"))
    # the agent: list_args, run with the other set, run with explicit args
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4); page.click(".sheet-head button")
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.evaluate("""window.__plan = [[['list_args', {}], ['run', {file: 'main.bend', set: 'missing'}], ['run', {file: 'main.bend', args: ['test/data/out.txt']}]]]""")
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=60000); time.sleep(0.3)
    log = page.evaluate("window.__seen")[0]["log"]
    for l in log: print(l[:900])
    check("list_args names the sets and files", "missing" in log[0] and "test/data/in.txt" in log[0] and "default" in log[0], log[0])
    check("run with a set", "nope.txt" in log[1], log[1])
    check("run with args reads the kept file", "read copy: hello data" in log[2], log[2])
    check("agent sees file text", "copy: copy: hello data" in log[2], log[2])
    check("agent sees a hexdump", "00 01 02 ff" in log[2], log[2])
    # git: the commit holds test/data and .workshop/project.json; the zip too, and comes back
    page.click("#btn-proj"); time.sleep(0.2)
    page.locator(".sheet .btn", has_text="Git…").click(); time.sleep(0.8)
    page.locator(".git .btn", has_text="Create a repository").click(); time.sleep(1.5)
    changed = page.inner_text(".git-changes")
    check("git sees data files and project.json", "test/data/in.txt" in changed and ".workshop/project.json" in changed, changed)
    page.fill(".git input[placeholder='What changed']", "with data")
    page.locator(".git .btn", has_text="Commit").click(); time.sleep(1.5)
    check("committed", "No change" in page.inner_text(".git"), page.inner_text(".git")[:300])
    page.click(".sheet-head button"); time.sleep(0.2)
    page.click("#btn-settings"); time.sleep(0.3)
    page.locator(".args-box select").select_option("1"); time.sleep(0.2)
    page.click(".sheet-head button"); time.sleep(0.2)
    page.click("#btn-proj"); time.sleep(0.2)
    page.locator(".sheet .btn", has_text="Git…").click(); time.sleep(0.8)
    check("switching the active set is a change", ".workshop/project.json" in page.inner_text(".git-changes"))
    page.click(".sheet-head button"); time.sleep(0.2)
    page.click("#btn-proj")
    with page.expect_download() as dl:
        page.click("text=Export as .zip")
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
    names = zipfile.ZipFile(path).namelist()
    check("zip holds test/data", any(n.endswith("/test/data/in.txt") for n in names) and any(n.endswith("/test/data/out.txt") for n in names), names[:12])
    out = tempfile.mkdtemp(); zipfile.ZipFile(path).extractall(out)
    top = os.path.join(out, os.listdir(out)[0])
    tree = subprocess.run(["git", "ls-tree", "-r", "--name-only", "HEAD"], cwd=top, capture_output=True, text=True).stdout.split()
    check("real git: data and project.json committed", "test/data/in.txt" in tree and ".workshop/project.json" in tree, tree)
    meta = json.load(open(os.path.join(top, ".workshop", "project.json")))
    check("project.json: sets and active", meta["args"]["active"] == "missing" and [x["name"] for x in meta["args"]["sets"]] == ["default", "missing"], meta)
    page.evaluate("localStorage.clear()"); page.evaluate("indexedDB.deleteDatabase('bend-workshop')")
    page.reload(); page.wait_for_selector("#verdict", timeout=30000); time.sleep(0.8)
    page.click("#btn-proj")
    with page.expect_file_chooser() as fc:
        page.click("text=Import…")
    fc.value.set_files(path); time.sleep(1.5)
    if page.locator(".sheet").count(): page.click(".sheet-head button"); time.sleep(0.2)
    page.click("#btn-settings"); time.sleep(0.3)
    box = page.locator(".args-box")
    check("imported: sets, active set, data files", box.locator("select").input_value() == "1" and "test/data/out.txt" in box.inner_text(), box.inner_text()[:300])
    page.click(".sheet-head button"); time.sleep(0.2)
    page.click("#btn-proj"); time.sleep(0.2)
    page.locator(".sheet .btn", has_text="Git…").click(); time.sleep(0.8)
    check("imported: the uncommitted set switch is still a change, data files are not", ".workshop/project.json" in page.inner_text(".git-changes") and "test/data" not in page.inner_text(".git-changes"), page.inner_text(".git")[:300])
    for e in errs: print("!!", e[:300])
    b.close()
