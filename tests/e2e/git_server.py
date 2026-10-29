"""A git server over HTTP for the tests: git's own http-backend as CGI,
with CORS headers or without (a host that refuses pages, as GitHub does),
and an optional Basic login for pushes; plus a CORS proxy of the
@isomorphic-git/cors-proxy shape (<proxy>/<host>/<path>, here to http)."""
import http.server, socketserver, subprocess, threading, base64, urllib.request, os

CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*", "Access-Control-Expose-Headers": "*"}

class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def serve_git(port, root, cors=True, login=None):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def cors(self):
            if cors:
                for k, v in CORS.items(): self.send_header(k, v)
        def do_OPTIONS(self):
            self.send_response(204); self.cors(); self.end_headers()
        def do_GET(self): self.cgi()
        def do_POST(self): self.cgi()
        def cgi(self):
            path, _, query = self.path.partition("?")
            push = "git-receive-pack" in path or "service=git-receive-pack" in query
            if push and login:
                want = "Basic " + base64.b64encode(login.encode()).decode()
                if self.headers.get("Authorization") != want:
                    self.send_response(401); self.send_header("WWW-Authenticate", 'Basic realm="git"'); self.cors(); self.end_headers(); return
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            env = dict(os.environ, GIT_PROJECT_ROOT=root, GIT_HTTP_EXPORT_ALL="1", REQUEST_METHOD=self.command,
                       PATH_INFO=path, QUERY_STRING=query, CONTENT_TYPE=self.headers.get("Content-Type", ""),
                       CONTENT_LENGTH=str(len(body)), REMOTE_USER="tester", REMOTE_ADDR="127.0.0.1",
                       HTTP_CONTENT_ENCODING=self.headers.get("Content-Encoding", ""))
            out = subprocess.run(["git", "http-backend"], input=body, env=env, capture_output=True).stdout
            head, _, rest = out.partition(b"\r\n\r\n")
            status = 200
            headers = []
            for line in head.decode().split("\r\n"):
                k, _, v = line.partition(":")
                if k.lower() == "status": status = int(v.strip().split()[0])
                elif k: headers.append((k, v.strip()))
            self.send_response(status)
            for k, v in headers: self.send_header(k, v)
            self.send_header("Content-Length", str(len(rest)))
            self.cors(); self.end_headers(); self.wfile.write(rest)
    s = Threaded(("127.0.0.1", port), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

def serve_proxy(port):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_OPTIONS(self):
            self.send_response(204)
            for k, v in CORS.items(): self.send_header(k, v)
            self.end_headers()
        def do_GET(self): self.fwd()
        def do_POST(self): self.fwd()
        def fwd(self):
            url = "http://" + self.path.lstrip("/")
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0)) if self.command == "POST" else None
            req = urllib.request.Request(url, data=body, method=self.command)
            for k in ["Content-Type", "Authorization", "Accept", "Git-Protocol"]:
                if self.headers.get(k): req.add_header(k, self.headers.get(k))
            try:
                r = urllib.request.urlopen(req); code = r.status; data = r.read(); hs = r.headers
            except urllib.error.HTTPError as e:
                code = e.code; data = e.read(); hs = e.headers
            self.send_response(code)
            for k in ["Content-Type", "WWW-Authenticate"]:
                if hs.get(k): self.send_header(k, hs.get(k))
            self.send_header("Content-Length", str(len(data)))
            for k, v in CORS.items(): self.send_header(k, v)
            self.end_headers(); self.wfile.write(data)
    s = Threaded(("127.0.0.1", port), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

def make_repo(root, name, files):
    """A bare repository with one commit of files, pushes allowed."""
    import tempfile
    work = tempfile.mkdtemp()
    run = lambda *a, cwd=work: subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True)
    run("init", "-q", "-b", "main")
    for n, text in files.items():
        os.makedirs(os.path.dirname(os.path.join(work, n)) or work, exist_ok=True)
        open(os.path.join(work, n), "w").write(text)
    run("add", "."); run("-c", "user.name=Seed", "-c", "user.email=seed@x", "commit", "-q", "-m", "seed")
    bare = os.path.join(root, name)
    subprocess.run(["git", "clone", "-q", "--bare", work, bare], check=True)
    subprocess.run(["git", "config", "http.receivepack", "true"], cwd=bare, check=True)
    return bare
