"""Dev server for public/ with caching disabled, so module edits show on reload.

    python scripts/serve.py            # http://127.0.0.1:8765
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter
        if "404" in (args[1] if len(args) > 1 else ""):
            super().log_message(fmt, *args)


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
root = Path(__file__).resolve().parent.parent / "public"
ThreadingHTTPServer(("127.0.0.1", port), partial(NoCache, directory=str(root))).serve_forever()
