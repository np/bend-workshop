// The git of the page: isomorphic-git and its HTTP client for browsers,
// bundled apart from the checker (dist/bend-git.js, global BendGit) and
// carried in the page compressed, unpacked the first time git is used.
import "./shim.js";
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/web";

export { git, http };
