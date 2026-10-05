# Builds a hub package with real hashes, for e2e44: e2e/fakehub/pkg.json and lib.zip.
import hashlib, json, os, zipfile
here = os.path.join(os.path.dirname(__file__), "fakehub")
os.makedirs(here, exist_ok=True)
files = {
  "lib.bend": "import Base\nimport ./color.bend as C\n\n# Doubles a number.\ndef double(+n: Nat) -> Nat:\n  Nat.add(n, n)\n\n# The color a number stands for.\ndef paint(n: Nat) -> C.Color:\n  match n:\n    case 0n:\n      C.Red{}\n    case 1n+p:\n      C.Green{}\n",
  "color.bend": "import Base\n\ntype Color is Data:\n  Red{}\n  Green{}\n",
}
man = "".join(hashlib.sha256(t.encode()).hexdigest() + " " + p + "\n" for p, t in sorted(files.items()))
pkg = "0x" + hashlib.sha256(man.encode()).hexdigest()[:32]
json.dump({"pkg": pkg, "files": files, "manifest": man}, open(os.path.join(here, "pkg.json"), "w"))
with zipfile.ZipFile(os.path.join(here, "lib.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    for p, t in files.items():
        z.writestr("lib/" + pkg + "/" + p, t)
    z.writestr("lib/" + pkg + "/manifest", man)
    z.writestr("lib/names/fake@1.0.0.0", pkg + "\n")
print(pkg)
