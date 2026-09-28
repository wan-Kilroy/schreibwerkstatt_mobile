"""Phone version: runs the desktop server.py / llm.py / topics.py unchanged inside the browser (Pyodide).

worker.js calls  handle(method, path, qs, body, ui_lang, replay)  for every /api/... request the page makes,
exactly the routes server.py's HTTP handler would call.  Nothing listens on a port.

Model calls: llm.py's _http() is replaced.  A browser cannot block while it waits for the network, so a request
that needs the network raises NeedFetch; worker.js does the fetch asynchronously and calls handle() again with
the answers so far (replay).  llm.py's code runs again from the start and gets the recorded answers in order, so
its retries (DeepSeek's empty JSON, parameters a service rejects ...) work exactly as on the desktop.
"""
import json
import os
import sys
import traceback
from contextlib import closing
from urllib.parse import urlparse

os.environ["SW_DATA"] = "/data"
sys.path.insert(0, "/app")

import llm      # noqa: E402
import server   # noqa: E402

ON_DEVICE = {"zh": "这台设备的浏览器里（german.db）", "en": "this device's browser (german.db)", "de": "im Browser dieses Geräts (german.db)"}

# Ollama cannot run on a phone: new installs start with Anthropic selected
_orig_defaults = llm._defaults


def _defaults():
    d = _orig_defaults()
    d["active"] = "anthropic"
    return d


llm._defaults = _defaults


class NeedFetch(Exception):
    def __init__(self, req):
        super().__init__("network request needed")
        self.req = req


_replay = {"i": 0, "res": []}


def _http(method, url, headers=None, payload=None, timeout=180):
    i = _replay["i"]
    _replay["i"] += 1
    if i >= len(_replay["res"]):
        h = {"Accept": "application/json"}
        if payload is not None:
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        if "x-api-key" in h:                         # Anthropic answers a browser only when it is told so
            h["anthropic-dangerous-direct-browser-access"] = "true"
        raise NeedFetch({"method": method, "url": url, "headers": h,
                         "body": json.dumps(payload) if payload is not None else None, "timeout": timeout})
    r = _replay["res"][i]
    if r.get("error") == "timeout":
        raise llm.LlmError("timeout", llm.T("timeout") % timeout)
    if r.get("error"):
        raise llm.LlmError("network", llm.T("network") % (urlparse(url).netloc, r.get("msg") or "network error"))
    status, text = r.get("status", 0), r.get("text") or ""
    if status >= 400:
        kind = {401: "auth", 403: "auth", 404: "notfound", 429: "rate"}.get(status, "http")
        raise llm.LlmError(kind, llm._err_text(text.encode("utf-8")), status)
    try:
        return json.loads(text)
    except ValueError:
        raise llm.LlmError("http", llm.T("not_json") + text[:200])


llm._http = _http

server.init_db()


def handle(method, path, qs_json, body_json, ui_lang, replay_json):
    """Returns JSON: [status, body]  or  {"need": request} when the network is needed first."""
    _replay["i"], _replay["res"] = 0, json.loads(replay_json or "[]")
    parts = [x for x in path.split("/") if x]
    qs = json.loads(qs_json or "{}")
    llm.ui.lang = ui_lang if ui_lang in llm.LANGS else "zh"
    try:
        try:
            body = json.loads(body_json) if body_json else {}
        except ValueError:
            raise server.ApiError(400, "invalid JSON")
        if not isinstance(body, dict):
            raise server.ApiError(400, "JSON object expected")
        done = server.route_llm(method, parts[1:], body)
        if done is None:
            with closing(server.connect()) as c:
                done = server.route(c, method, parts, qs, body)
                c.commit()
    except NeedFetch as e:
        return json.dumps({"need": e.req}, ensure_ascii=False)
    except server.ApiError as e:
        done = (e.code, {"error": e.msg})
    except Exception as e:
        traceback.print_exc()
        done = (500, {"error": str(e)})
    code, obj = done
    if parts[1:] == ["health"] and code == 200:
        obj = dict(obj, db=ON_DEVICE.get(llm.ui.lang, ON_DEVICE["zh"]), mobile=True)
    return json.dumps([code, obj], ensure_ascii=False)


def import_db(path):
    """A database file the student chose (a backup, or german.db from the computer) replaces the current one.
    The current one is kept as german.db.bak-before-import-...; the imported file is migrated to this version."""
    import sqlite3
    from datetime import datetime
    with closing(sqlite3.connect(path)) as t:
        t.execute("SELECT COUNT(*) FROM sessions").fetchone()      # raises if it is not a Schreibwerkstatt database
    if os.path.exists(server.DB_PATH):
        os.replace(server.DB_PATH, "%s.bak-before-import-%s" % (server.DB_PATH, datetime.now().strftime("%Y%m%d-%H%M%S")))
    os.replace(path, server.DB_PATH)
    server.init_db()
    prune_backups()
    with closing(server.connect()) as c:
        return c.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]


def prune_backups(keep=3):
    """Migrations and imports leave german.db.bak-* files; on a phone only the newest few are kept."""
    d = os.path.dirname(server.DB_PATH)
    baks = sorted((f for f in os.listdir(d) if f.startswith("german.db.bak-")), key=lambda f: os.path.getmtime(os.path.join(d, f)))
    for f in baks[:-keep] if keep else baks:
        try:
            os.remove(os.path.join(d, f))
        except OSError:
            pass


prune_backups()
