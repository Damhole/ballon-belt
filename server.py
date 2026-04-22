from http.server import HTTPServer, SimpleHTTPRequestHandler

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory='/Users/denishrazdira/Documents/GitHub/ballon-belt/.claude/worktrees/kind-dubinsky-31ff85', **kwargs)

HTTPServer(('', 8080), Handler).serve_forever()
