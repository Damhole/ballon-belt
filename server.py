#!/usr/bin/env python3
# Dev server for Balloon Belt.
# Serves the repo root so both /editor/ and /gamee/ live under the same origin —
# required for the editor's live iframe preview (iframe src="../gamee/index_local.html").
#
# Run: python3 server.py
# Browse: http://localhost:8080/editor/index.html
#         http://localhost:8080/gamee/index_local.html
#
# Why not preview_start (Ruby WEBrick on /tmp)? preview_start runs under Claude
# Code's sandbox and can't reach ~/Documents/ (TCC). Running this script from
# Terminal.app uses the user's normal file permissions, so FSA writes from the
# editor (into this same folder) are visible to the iframe immediately.

import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO_ROOT, **kwargs)

    def end_headers(self):
        # Disable browser caching so iframe reloads always pick up the latest
        # gamee/js/levels.js written by the editor.
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    print('Balloon Belt dev server -> http://localhost:8080/')
    print('  editor: http://localhost:8080/editor/index.html')
    print('  game:   http://localhost:8080/gamee/index_local.html')
    print('  root:   ' + REPO_ROOT)
    HTTPServer(('', 8080), NoCacheHandler).serve_forever()
