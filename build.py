#!/usr/bin/env python3
"""Builds the phone version into docs/ (the folder GitHub Pages publishes).

It takes the CURRENT desktop version from ../schreibwerkstatt (or the folder given as the first argument):
  web/*                                      -> docs/            (the page, unchanged; index.html gets 4 extra lines)
  server.py llm.py topics.py stopwords_*.txt -> docs/py/         (run in the phone's browser by Pyodide)
plus the phone-only files from mobile/ (worker.js, boot.js, mobile.css, sw.js, icons ...).
docs/pyodide/ (Python for the browser, ~13 MB) is kept as it is.

So after a change to the desktop version:   python build.py   then upload (git push) - done.

Standard library only.
"""
import hashlib
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
def find_desktop():
    """The desktop version: the first argument, else a folder named schreibwerkstatt next to this folder or one level up."""
    if len(sys.argv) > 1:
        return os.path.abspath(sys.argv[1])
    for up in ("..", os.path.join("..", "..")):
        cand = os.path.abspath(os.path.join(HERE, up, "schreibwerkstatt"))
        if os.path.isfile(os.path.join(cand, "server.py")):
            return cand
    return os.path.abspath(os.path.join(HERE, "..", "schreibwerkstatt"))


SRC = find_desktop()
MOBILE = os.path.join(HERE, "mobile")
OUT = os.path.join(HERE, "docs")
KEEP = {"pyodide"}                                   # never deleted by a rebuild
PY_FILES = ["server.py", "llm.py", "topics.py"]      # + every stopwords_*.txt
MOBILE_FILES = ["boot.js", "worker.js", "i18n_mobile.js", "mobile.css", "manifest.webmanifest"]
PYODIDE_FILES = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]

HEAD_EXTRA = """<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Schreiben">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#1f6f5c">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
"""


def fail(msg):
    print("ERROR: " + msg)
    sys.exit(1)


def patch_index(html):
    """The desktop index.html plus: viewport for the iPhone notch, home-screen tags, mobile.css, boot.js and the phone texts before main.js."""
    html, n = re.subn(r'<meta name="viewport" content="[^"]*">',
                      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">\n' + HEAD_EXTRA.rstrip("\n"),
                      html, count=1)
    if n != 1:
        fail("index.html: <meta name=\"viewport\"> not found")
    html, n = re.subn(r'(<link rel="stylesheet" href="app.css">)', r'\1\n<link rel="stylesheet" href="mobile.css">', html, count=1)
    if n != 1:
        fail("index.html: <link rel=\"stylesheet\" href=\"app.css\"> not found")
    html, n = re.subn(r'(<script type="module" src="js/main.js"></script>)', r'<script src="boot.js"></script>\n<script type="module" src="i18n_mobile.js"></script>\n\1', html, count=1)
    if n != 1:
        fail("index.html: <script type=\"module\" src=\"js/main.js\"> not found")
    return html


def main():
    web = os.path.join(SRC, "web")
    for need in [os.path.join(web, "index.html")] + [os.path.join(SRC, f) for f in PY_FILES]:
        if not os.path.isfile(need):
            fail("desktop version not found: %s\n(usage: python build.py [folder of the desktop version])" % need)
    missing = [f for f in PYODIDE_FILES if not os.path.isfile(os.path.join(OUT, "pyodide", f))]
    if missing:
        fail("docs/pyodide/ is incomplete (missing: %s)" % ", ".join(missing))

    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):                     # fresh build, except the big Pyodide files
        if name in KEEP:
            continue
        p = os.path.join(OUT, name)
        shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)

    # 1. the page
    for root, _, files in os.walk(web):
        for f in files:
            src = os.path.join(root, f)
            dst = os.path.join(OUT, os.path.relpath(src, web))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
    with open(os.path.join(web, "index.html"), encoding="utf-8") as f:
        html = patch_index(f.read())
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(html)

    # 2. the Python side
    py_dir = os.path.join(OUT, "py")
    os.makedirs(py_dir)
    py = PY_FILES + sorted(f for f in os.listdir(SRC) if re.match(r"stopwords_.*\.txt$", f)) + ["mobile_glue.py"]
    for f in py:
        shutil.copy2(os.path.join(MOBILE if f == "mobile_glue.py" else SRC, f), os.path.join(py_dir, f))
    with open(os.path.join(py_dir, "files.json"), "w", encoding="utf-8") as f:
        json.dump(py, f)

    # 3. phone-only files
    for f in MOBILE_FILES:
        shutil.copy2(os.path.join(MOBILE, f), os.path.join(OUT, f))
    shutil.copytree(os.path.join(MOBILE, "icons"), os.path.join(OUT, "icons"))
    open(os.path.join(OUT, ".nojekyll"), "w").close()   # GitHub Pages: publish the files as they are

    # 4. service worker: every file, and a version that changes whenever any file changes
    files, h = [], hashlib.sha256()
    for root, dirs, fs in os.walk(OUT):
        dirs.sort()
        for f in sorted(fs):
            rel = os.path.relpath(os.path.join(root, f), OUT).replace(os.sep, "/")
            if rel in ("sw.js", ".nojekyll"):
                continue
            files.append(rel)
            h.update(rel.encode())
            with open(os.path.join(root, f), "rb") as fh:
                h.update(hashlib.sha256(fh.read()).digest())
    version = "sw-" + h.hexdigest()[:12]
    with open(os.path.join(MOBILE, "sw.template.js"), encoding="utf-8") as f:
        sw = f.read().replace("__VERSION__", version).replace("__FILES__", json.dumps(["./"] + files, indent=0))
    with open(os.path.join(OUT, "sw.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write(sw)

    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in files)
    print("Built docs/ from %s" % SRC)
    print("  %d files, %.1f MB, version %s" % (len(files), size / 1e6, version))
    print("  Next: upload to GitHub (see README.md).")


if __name__ == "__main__":
    main()
