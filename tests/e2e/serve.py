import http.server, socketserver, threading, functools, os, shutil

def serve(directory, port=8123, csp=None):
    class H(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            if csp:
                self.send_header("Content-Security-Policy", csp)
            super().end_headers()
        def log_message(self, *a):
            pass
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", port), functools.partial(H, directory=directory))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# Screenshots go to tests/e2e/shots (ignored by git); fixtures live in tests/e2e/fixtures.
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
FIXTURES = os.path.join(HERE, "fixtures")


def shot(name):
    os.makedirs(SHOTS, exist_ok=True)
    return os.path.join(SHOTS, os.path.basename(name))


def fixture(name):
    return os.path.join(FIXTURES, name)


def frame_page(dist="dist"):
    """A page that loads the workshop in a sandboxed iframe: an opaque origin, no storage."""
    shutil.copy(fixture("frame.html"), os.path.join(dist, "frame.html"))
