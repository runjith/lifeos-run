#!/usr/bin/env python3
"""Raise the version before you deploy.

    python3 bump.py            1.1.0 -> 1.1.1
    python3 bump.py 1.2.0      set it yourself

It updates version.txt, the version shown in More -> About, and the offline
cache name in sw.js. Bumping matters: browsers keep serving the cached copy of
LifeOS until the cache name changes, so without it your update may not appear.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
current = (ROOT / "version.txt").read_text().strip()

if len(sys.argv) > 1:
    new = sys.argv[1].strip()
else:
    parts = current.split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    new = ".".join(parts)

(ROOT / "version.txt").write_text(new + "\n")

cfg = ROOT / "js" / "config.js"
cfg.write_text(re.sub(r'window\.LX\.VERSION = "[^"]*";',
                      'window.LX.VERSION = "%s";' % new, cfg.read_text()))

sw = ROOT / "sw.js"
sw.write_text(re.sub(r'var CACHE = "[^"]*";', 'var CACHE = "lifeos-%s";' % new, sw.read_text()))

print("%s -> %s" % (current, new))
print("Now commit and push. GitHub Pages redeploys in about a minute.")
