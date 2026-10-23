"""Static dev server for the repo root that disables browser caching of the code.

python -m http.server lets the browser cache ES modules, so after an edit a
page can mix old and new modules. This server sends Cache-Control: no-store,
except for the card images (assets/), cached for an hour so that the preload
is worth something.

Usage:
    python tools/serve.py [port]      (default 8000; the project uses 8012)
"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "max-age=3600" if self.path.startswith("/assets/") else "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    http.server.ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
