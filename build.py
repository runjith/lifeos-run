#!/usr/bin/env python3
"""Bundle LifeOS into a single self-contained HTML file.

    python3 build.py            -> dist/lifeos.html

The multi-file version in this folder is the one you host (it can register a
service worker and be installed as an app). The single file is handy for
emailing yourself a copy, opening straight from Files on an iPhone, or pasting
into any static host that takes one file.
"""
import base64
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "dist" / "lifeos.html"

html = (ROOT / "index.html").read_text()

# inline stylesheets
def inline_css(match):
    href = match.group(1)
    if href.startswith("http"):
        return match.group(0)
    css = (ROOT / href).read_text()
    return "<style>\n%s\n</style>" % css

html = re.sub(r'<link rel="stylesheet" href="([^"]+)" />', inline_css, html)

# inline scripts, keeping load order
def inline_js(match):
    src = match.group(1)
    js = (ROOT / src).read_text()
    return "<script>\n/* ---- %s ---- */\n%s\n</script>" % (src, js)

html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)

# the single file has no manifest or service worker to fetch
html = html.replace('<link rel="manifest" href="manifest.webmanifest" />', "")
icon = base64.b64encode((ROOT / "icon-180.png").read_bytes()).decode()
html = html.replace('href="icon-180.png"', 'href="data:image/png;base64,%s"' % icon)

OUT.parent.mkdir(exist_ok=True)
OUT.write_text(html)
print("wrote %s (%.0f KB)" % (OUT, OUT.stat().st_size / 1024))
