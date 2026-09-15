#!/usr/bin/env python3
"""Make the Clothing App work offline by vendoring three.js locally.

Usage:  python vendor.py            downloads three.js (pinned version) into ./vendor/three/
        python vendor.py --restore  switches the import maps back to the CDN

Only run this if you want offline use; the app works from the CDN by default.
Downloads come from https://cdn.jsdelivr.net/npm/three@<VERSION>/ .
"""
import os
import re
import sys
import urllib.request

VERSION = "0.180.0"
BASE = f"https://cdn.jsdelivr.net/npm/three@{VERSION}/"
ROOT = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(ROOT, "vendor", "three")

# Files the app imports (keep in sync with the import statements under src/).
FILES = [
    "build/three.module.js",
    "examples/jsm/controls/OrbitControls.js",
    "examples/jsm/utils/BufferGeometryUtils.js",
]

HTML_FILES = ["index.html", "popout.html"]
CDN_MAP = (
    f'"three": "{BASE}build/three.module.js",\n'
    f'  "three/addons/": "{BASE}examples/jsm/"'
)
LOCAL_MAP = (
    '"three": "./vendor/three/build/three.module.js",\n'
    '  "three/addons/": "./vendor/three/examples/jsm/"'
)
MAP_RE = re.compile(r'"three":\s*"[^"]+",\s*\n\s*"three/addons/":\s*"[^"]+"')


def rewrite(target: str) -> None:
    for name in HTML_FILES:
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            html = f.read()
        new = MAP_RE.sub(lambda _m: target, html, count=1)
        if new != html:
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(new)
            print(f"updated import map in {name}")


def main() -> None:
    if "--restore" in sys.argv:
        rewrite(CDN_MAP)
        return
    for rel in FILES:
        dst = os.path.join(VENDOR, *rel.split("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        url = BASE + rel
        print(f"downloading {url}")
        with urllib.request.urlopen(url, timeout=60) as r, open(dst, "wb") as f:
            f.write(r.read())
    rewrite(LOCAL_MAP)
    print(f"done: three.js {VERSION} vendored under vendor/three/")


if __name__ == "__main__":
    main()
