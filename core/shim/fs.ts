// A tiny in-memory file system: just what bend.ts and comp.ts ask of node:fs.
import * as path from "./path.ts";
import { ASSETS } from "../../gen/assets.ts";

// base.bend and the effects are there before bend.ts looks for them.
export const FILES: Map<string, string> = new Map(Object.entries(ASSETS));

function norm(p: string): string {
  return path.resolve(String(p));
}

function enoent(p: string): never {
  const e = new Error("ENOENT: no such file or directory, '" + p + "'") as Error & { code: string; errno: number };
  e.code = "ENOENT";
  e.errno = -2;
  throw e;
}

export function existsSync(p: string): boolean {
  const n = norm(p);
  if (FILES.has(n)) {
    return true;
  }
  const d = n.endsWith("/") ? n : n + "/";
  for (const k of FILES.keys()) {
    if (k.startsWith(d)) {
      return true;
    }
  }
  return false;
}

export function realpathSync(p: string): string {
  const n = norm(p);
  return existsSync(n) ? n : enoent(p);
}

export function readFileSync(p: string, _enc?: unknown): string {
  const got = FILES.get(norm(p));
  return got === undefined ? enoent(p) : got;
}

export function writeFileSync(p: string, text: string, _o?: unknown): void {
  FILES.set(norm(p), String(text));
}

export function mkdirSync(_p: string, _o?: unknown): void {}

export function statSync(p: string): { isDirectory(): boolean } {
  const n = norm(p);
  if (!existsSync(n)) {
    enoent(p);
  }
  return { isDirectory: () => !FILES.has(n) };
}

export function readdirSync(_p: string): string[] {
  return [];
}

export function rmSync(_p: string, _o?: unknown): void {}

export function mkdtempSync(p: string): string {
  return p + "x";
}

export function openSync(): never {
  const e = new Error("EBADF") as Error & { code: string };
  e.code = "EBADF";
  throw e;
}

export function closeSync(): void {}

export function copyFileSync(): void {}
