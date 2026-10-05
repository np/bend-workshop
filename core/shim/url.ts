export function fileURLToPath(u: string | URL): string {
  return decodeURIComponent(new URL(String(u)).pathname);
}
