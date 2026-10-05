// The kernel is a native binary: no child runs in a page.
export function spawnSync(): never {
  throw new Error("the BendTT kernel is a Lean binary: run bend <file> --verdict with the CLI");
}
export function execSync(): never {
  return spawnSync();
}
