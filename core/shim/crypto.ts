// Only kernel_bin hashes, to name a build of the kernel: never reached here.
export function createHash(): never {
  throw new Error("no crypto in the page");
}
