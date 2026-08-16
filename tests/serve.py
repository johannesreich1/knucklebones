"""Serves ./pwa on http://127.0.0.1:8123 — service workers refuse file:// pages.
Run from the repo root:  python3 tests/serve.py"""
import http.server, socketserver, functools
class H(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        if path.endswith('.webmanifest'): return 'application/manifest+json'
        if path.endswith('.js'): return 'text/javascript'
        return super().guess_type(path)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', 8123), functools.partial(H, directory='pwa')) as s:
    print('serving ./pwa on http://127.0.0.1:8123')
    s.serve_forever()
