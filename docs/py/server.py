#!/usr/bin/env python3
"""Schreibwerkstatt local server (standard library only).

* serves index.html
* keeps the model settings (incl. the API key) and talks to the model for the page  (see llm.py):
  Ollama, any OpenAI-compatible service, or Anthropic  ->  /api/settings, /api/llm/...
* stores every session and message in a SQLite file (german.db) and exposes it as a small JSON API
* multi-language (v0.2): every session carries the language being learned (lang) and the language used for
  explanations, exercise sentences and the interface (explain_lang); old data = German learned, Chinese explanations

Where the data lives (german.db + settings.json), first match wins:
  1. environment variable SW_DATA  (a folder)
  2. ../data  if it already contains german.db   (one shared data folder for several app versions)
  3. ./data   next to this file

Run:  python server.py     (or double-click run.bat)
"""
import json
import os
import re
import sqlite3
import sys
import traceback
from contextlib import closing
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import llm
import topics

HOST = "127.0.0.1"
PORT = int(os.environ.get("SW_PORT", "8000"))
ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")                       # the page: index.html, app.css, js/*.js (nothing else is served)
STATIC_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                ".js": "text/javascript; charset=utf-8"}   # fixed: Windows' registry sometimes maps .js to text/plain,
                                                            # and browsers refuse to run modules served like that
WORD_RE = re.compile(r"[^\W_][^\W_'’\-]*(?:['’\-][^\W_]+)*")

# ---- languages (v0.2).  Codes are BCP 47 tags: de, en, fr, es, ja, zh, pt-BR, zh-Hant ...
DEFAULT_LANG, DEFAULT_EXPLAIN_LANG = "de", "zh"   # what every session made before v0.2 was
LANG_RE = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2"}
# languages written without spaces between words: a "word" in the statistics is one character there
NO_SPACE_LANGS = {"zh", "ja", "th", "lo", "km", "my", "yue", "wuu"}
NO_SPACE_CHAR_RE = re.compile("[\u0e00-\u0eff\u1000-\u109f\u1780-\u17ff\u2e80-\u9fff\uf900-\ufaff\uff66-\uff9f\U00020000-\U0002ffff]")


def resolve_db_path():
    if os.environ.get("SW_DB"):                                   # tests / power users: an exact file
        return os.path.abspath(os.environ["SW_DB"])
    if os.environ.get("SW_DATA"):
        return os.path.join(os.path.abspath(os.environ["SW_DATA"]), "german.db")
    shared = os.path.join(os.path.dirname(ROOT), "data", "german.db")
    if os.path.isfile(shared):
        return shared
    return os.path.join(ROOT, "data", "german.db")


DB_PATH = resolve_db_path()


def settings_file():
    return os.path.join(os.path.dirname(DB_PATH), "settings.json")     # follows DB_PATH, also after a fallback

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL DEFAULT '',      -- short topic, generated when the session ends
  summary    TEXT NOT NULL DEFAULT '',      -- 1-2 sentences: topics and grammar points practised
  created_at TEXT NOT NULL,                 -- UTC, ISO 8601
  ended_at   TEXT,
  lang         TEXT NOT NULL DEFAULT 'de',  -- language being learned (BCP 47 code)
  explain_lang TEXT NOT NULL DEFAULT 'zh',  -- language of explanations, exercise sentences and the interface
  level        TEXT                         -- A1 ... C2; NULL = the app's default
);
CREATE TABLE IF NOT EXISTS messages(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  kind        TEXT NOT NULL,                -- assistant: prompt | reply | answer   user: translate | chat | ask
  content     TEXT NOT NULL,
  zh          TEXT,                         -- translate: the source sentence that was to be translated (in the session's
                                            -- explain_lang; the column keeps its old name, the API also accepts "source")
  status      TEXT,                         -- prompt: pending | answered | skipped
  is_correct  INTEGER,                      -- user translate/chat: 1 / 0 (NULL = not checked)
  corrected   TEXT,                         -- minimal-edit correction of the student's sentence
  better      TEXT,                         -- optional, more idiomatic version
  better_note TEXT,
  meaning     TEXT,                         -- translate: ok | off
  brief       TEXT,                         -- one-line comment
  explanation TEXT,                         -- filled when the student clicks "detailed explanation"
  retyped     INTEGER,                      -- how many times the student copied the corrected sentence (跟着敲)
  focus       TEXT,                         -- prompt: the grammar point the question was generated for (NULL = unknown)
  created_at  TEXT NOT NULL,
  extra       TEXT,                         -- JSON object for language-specific extras, e.g. {"py": pinyin of corrected,
                                            -- "better_py": pinyin of better} when Chinese is learned
  errors      TEXT                          -- v0.4, user translate/chat: error types found, comma separated keys
                                            -- (article,word_order ...; the page has the names); NULL = not checked
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
-- statistics only: when a session is deleted its user messages are kept here as bare numbers (no text),
-- so "days practised" and the totals do not shrink
CREATE TABLE IF NOT EXISTS stat_archive(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER,                      -- id of the deleted session (ids are never reused); only used to count sessions per day
  kind        TEXT NOT NULL,                -- translate | chat | ask
  words       INTEGER NOT NULL,
  is_correct  INTEGER,
  retyped     INTEGER,
  created_at  TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'de',   -- language of the deleted session
  errors      TEXT                          -- error type keys (no text), for the "common mistakes" statistics
);
-- grammar points the exercise generator rotates through, per language learned (German is filled in on first start)
CREATE TABLE IF NOT EXISTS grammar_foci(
  lang   TEXT NOT NULL,
  pos    INTEGER NOT NULL,                  -- order in the list, 0-based
  focus  TEXT NOT NULL,
  level  TEXT,                              -- v0.5: A1 A2 B1 B2 C1 (C1 also serves C2); NULL = every level
  PRIMARY KEY (lang, pos)
);
-- v0.4 spaced review: every exercise sentence the student got wrong comes back after REVIEW_DAYS[step] days;
-- right again and again -> done, wrong -> starts over.  Filled automatically when a translation is checked.
CREATE TABLE IF NOT EXISTS reviews(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lang         TEXT NOT NULL,               -- language learned
  explain_lang TEXT NOT NULL,               -- language of the source sentence
  source       TEXT NOT NULL,               -- the exercise sentence (written by the model, not by the student)
  focus        TEXT,                        -- its grammar point, if known
  step         INTEGER NOT NULL DEFAULT 0,  -- index into REVIEW_DAYS
  due_at       TEXT,                        -- UTC; NULL once done
  done_at      TEXT,                        -- mastered (or removed by the student)
  n_wrong      INTEGER NOT NULL DEFAULT 0,
  n_right      INTEGER NOT NULL DEFAULT 0,
  last_msg_id  INTEGER NOT NULL DEFAULT 0,  -- newest answer already counted (a message is never counted twice)
  created_at   TEXT NOT NULL,
  UNIQUE (lang, explain_lang, source)
);
CREATE INDEX IF NOT EXISTS idx_reviews_due ON reviews(lang, explain_lang, due_at);
-- v0.6 reports: the student marks something as wrong ("this exercise sentence is unnatural" ...).  One table for
-- every kind, so it can grow into a general bug report list.  Text is a copy (the session may be deleted later).
CREATE TABLE IF NOT EXISTS reports(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL,
  kind         TEXT NOT NULL,               -- bad_exercise (later: bad_correction, app_bug ...)
  reason       TEXT,                        -- bad_exercise: unnatural | wrong | level | other
  message_id   INTEGER,                     -- the message it is about (NULL for app bugs)
  text         TEXT,                        -- copy of that message (e.g. the exercise sentence)
  focus        TEXT,                        -- grammar point of the exercise, if any
  lang         TEXT, explain_lang TEXT, level TEXT,
  provider     TEXT, model TEXT,            -- which model produced it
  note         TEXT                         -- optional words of the student
);
"""
REPORT_KINDS = {"bad_exercise": {"unnatural", "wrong", "level", "other"}}
VERSION = "0.7"                              # the page (web/js/db.js PAGE_VERSION) checks it: an old, still running server.py is noticed
REVIEW_DAYS = (1, 3, 7)                     # wrong -> again tomorrow; then after 3 and 7 more days; 3 x right = done
ERROR_KEY_RE = re.compile(r"^[a-z][a-z_]{0,23}$")

USER_KINDS = {"translate", "chat", "ask"}
ASSISTANT_KINDS = {"prompt", "reply", "answer"}
MSG_FIELDS = ("zh", "status", "is_correct", "corrected", "better", "better_note", "meaning", "brief", "explanation", "retyped", "focus", "extra",
              "errors")
SESSION_FIELDS = ("title", "summary", "ended_at", "level")


def now(delta_days=0):
    t = datetime.now(timezone.utc) + timedelta(days=delta_days)
    return t.isoformat(timespec="seconds").replace("+00:00", "Z")


def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # case-insensitive "contains" that also works for umlauts (SQLite's own LIKE only folds ASCII)
    conn.create_function("ci", 2, lambda text, q: 1 if text is not None and q in str(text).casefold() else 0)
    return conn


def init_db():
    with closing(connect()) as c:
        c.executescript(SCHEMA)
        cols = {r[1] for r in c.execute("PRAGMA table_info(messages)")}
        if "retyped" not in cols:                                   # database made by an earlier version
            c.execute("ALTER TABLE messages ADD COLUMN retyped INTEGER")
        if "focus" not in cols:                                     # added for the grammar-point rotation; old rows stay NULL
            backup_before_migration(c, "focus")
            c.execute("ALTER TABLE messages ADD COLUMN focus TEXT")
        # v0.2 multi-language: only adds columns with defaults, so older app versions keep working on the same file
        scols = {r[1] for r in c.execute("PRAGMA table_info(sessions)")}
        acols = {r[1] for r in c.execute("PRAGMA table_info(stat_archive)")}
        if not {"lang", "explain_lang", "level"} <= scols or "lang" not in acols:
            backup_before_migration(c, "multilang")
            if "lang" not in scols:
                c.execute("ALTER TABLE sessions ADD COLUMN lang TEXT NOT NULL DEFAULT '%s'" % DEFAULT_LANG)
            if "explain_lang" not in scols:
                c.execute("ALTER TABLE sessions ADD COLUMN explain_lang TEXT NOT NULL DEFAULT '%s'" % DEFAULT_EXPLAIN_LANG)
            if "level" not in scols:
                c.execute("ALTER TABLE sessions ADD COLUMN level TEXT")
            if "lang" not in acols:
                c.execute("ALTER TABLE stat_archive ADD COLUMN lang TEXT NOT NULL DEFAULT '%s'" % DEFAULT_LANG)
        if "extra" not in cols:                                     # v0.2: pinyin etc.; old rows stay NULL
            if {"lang", "explain_lang", "level"} <= scols and "lang" in acols:
                backup_before_migration(c, "extra")                 # (otherwise the multilang backup above covers it)
            c.execute("ALTER TABLE messages ADD COLUMN extra TEXT")
        cols = {r[1] for r in c.execute("PRAGMA table_info(messages)")}
        acols = {r[1] for r in c.execute("PRAGMA table_info(stat_archive)")}
        if "errors" not in cols or "errors" not in acols:           # v0.4: error types; old rows stay NULL
            backup_before_migration(c, "errors")
            if "errors" not in cols:
                c.execute("ALTER TABLE messages ADD COLUMN errors TEXT")
            if "errors" not in acols:
                c.execute("ALTER TABLE stat_archive ADD COLUMN errors TEXT")
            # once, on this update: translations already got wrong before v0.4 go into the review list (due tomorrow)
            for r in c.execute("SELECT id FROM messages WHERE role = 'user' AND kind = 'translate' AND is_correct IS NOT NULL "
                               "ORDER BY id").fetchall():
                review_after_answer(c, r["id"])
        c.execute("CREATE INDEX IF NOT EXISTS idx_sessions_lang ON sessions(lang, id)")
        backed_up = False
        if "level" not in {r[1] for r in c.execute("PRAGMA table_info(grammar_foci)")}:   # v0.5: grammar points by level
            backup_before_migration(c, "levels")
            backed_up = True
            c.execute("ALTER TABLE grammar_foci ADD COLUMN level TEXT")
        for lang, by_level in topics.GRAMMAR_FOCI_LEVELED.items():  # levelled list replaces the old built-in one, never
            old = foci_for(c, lang)                                 # a list the student edited (v0.7: English, French too)
            has_levels = c.execute("SELECT 1 FROM grammar_foci WHERE lang = ? AND level IS NOT NULL", (lang,)).fetchone()
            if not has_levels and (not old or old == topics.GRAMMAR_FOCI_BY_LANG.get(lang)):
                if old and not backed_up:
                    backup_before_migration(c, "levels")
                    backed_up = True
                c.execute("DELETE FROM grammar_foci WHERE lang = ?", (lang,))
                rows = [(lv, f) for lv in topics.LEVEL_GROUPS for f in by_level.get(lv, [])]
                c.executemany("INSERT INTO grammar_foci(lang, pos, focus, level) VALUES (?, ?, ?, ?)",
                              [(lang, i, f, lv) for i, (lv, f) in enumerate(rows)])
        for lang, foci in topics.GRAMMAR_FOCI_BY_LANG.items():     # built-in lists, only where a language has none yet
            if not c.execute("SELECT 1 FROM grammar_foci WHERE lang = ?", (lang,)).fetchone():
                c.executemany("INSERT INTO grammar_foci(lang, pos, focus) VALUES (?, ?, ?)", [(lang, i, f) for i, f in enumerate(foci)])
        c.commit()


def backup_before_migration(c, what):
    """A consistent copy of the database next to it (SQLite's own backup API) before the schema is changed."""
    try:
        dst = "%s.bak-before-%s-%s" % (DB_PATH, what, datetime.now().strftime("%Y%m%d-%H%M%S"))
        with closing(sqlite3.connect(dst)) as out:
            c.backup(out)
        print("  Database backup before the update: %s" % dst)
    except (OSError, sqlite3.Error) as e:
        print("  ! Could not back up the database before the update (%s) - continuing, the change only adds a column." % e)


class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code, self.msg = code, msg


def as_dict(row):
    return {k: row[k] for k in row.keys()}


def as_int(qs, key, default, lo, hi):
    try:
        return max(lo, min(hi, int(qs.get(key, default))))
    except ValueError:
        return default


def clean_lang(v, what="lang"):
    """A BCP 47 code, primary subtag in lower case ('DE' -> 'de', 'pt-BR' stays).  ApiError if it does not look like one."""
    if isinstance(v, str):
        head, _, tail = v.strip().partition("-")
        v = head.lower() + ("-" + tail if tail else "")
        if LANG_RE.match(v):
            return v
    raise ApiError(400, "%s must be a language code such as de, en, ja, pt-BR" % what)


def qs_lang(qs):
    """Optional ?lang= filter; None = all languages."""
    return clean_lang(qs["lang"]) if qs.get("lang") else None


def clean_level(v):
    if v is None:
        return None
    if not isinstance(v, str) or v.upper() not in LEVELS:
        raise ApiError(400, "level must be one of A1 A2 B1 B2 C1 C2 (or null)")
    return v.upper()


def session_lang(c, sid):
    r = c.execute("SELECT lang FROM sessions WHERE id = ?", (sid,)).fetchone()
    return r["lang"] if r else DEFAULT_LANG


# --------------------------------------------------------------------------- routes
def list_sessions(c, qs):
    q = (qs.get("q") or "").strip().casefold()
    limit, offset = as_int(qs, "limit", 200, 1, 1000), as_int(qs, "offset", 0, 0, 10**9)
    where, args = [], []
    lang = qs_lang(qs)
    if lang:
        where.append("s.lang = ?")
        args.append(lang)
    if qs.get("explain"):
        where.append("s.explain_lang = ?")
        args.append(clean_lang(qs["explain"], "explain"))
    if qs.get("summarized") == "1":
        where.append("s.summary <> ''")
    if q:
        where.append(
            "(ci(s.title, ?) OR ci(s.summary, ?) OR EXISTS (SELECT 1 FROM messages x WHERE x.session_id = s.id "
            "AND (ci(x.content, ?) OR ci(x.corrected, ?) OR ci(x.better, ?))))"
        )
        args += [q] * 5
    sql = (
        "SELECT s.id, s.title, s.summary, s.created_at, s.ended_at, s.lang, s.explain_lang, s.level, COUNT(m.id) AS n_messages, "
        "COALESCE(SUM(m.role = 'user' AND m.kind = 'translate'), 0) AS n_translate, "
        "COALESCE(SUM(m.role = 'user' AND m.kind = 'chat'), 0) AS n_chat, "
        "COALESCE(SUM(m.role = 'user' AND m.kind = 'ask'), 0) AS n_ask "
        "FROM sessions s LEFT JOIN messages m ON m.session_id = s.id "
        + ("WHERE " + " AND ".join(where) + " " if where else "")
        + "GROUP BY s.id HAVING COUNT(m.id) > 0 ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?"
    )
    out = []
    for r in c.execute(sql, args + [limit, offset]).fetchall():
        item = {
            "id": r["id"], "title": r["title"], "summary": r["summary"],
            "created_at": r["created_at"], "ended_at": r["ended_at"], "n_messages": r["n_messages"],
            "lang": r["lang"], "explain_lang": r["explain_lang"], "level": r["level"],
            "counts": {"translate": r["n_translate"], "chat": r["n_chat"], "ask": r["n_ask"]},
            "match": None,
        }
        if q:   # the first message text that contains the search term (for the snippet under the card)
            m = c.execute(
                "SELECT content, corrected, better FROM messages WHERE session_id = ? "
                "AND (ci(content, ?) OR ci(corrected, ?) OR ci(better, ?)) ORDER BY id LIMIT 1",
                (r["id"], q, q, q),
            ).fetchone()
            if m:
                item["match"] = next((t for t in (m["content"], m["corrected"], m["better"]) if t and q in t.casefold()), None)
        out.append(item)
    return 200, out


def get_session(c, sid):
    s = c.execute("SELECT * FROM sessions WHERE id = ?", (sid,)).fetchone()
    if not s:
        raise ApiError(404, "session not found")
    msgs = [as_dict(r) for r in c.execute("SELECT * FROM messages WHERE session_id = ? ORDER BY id", (sid,))]
    for m in msgs:
        m["source"] = m["zh"]                                       # v0.2 name; "zh" stays for older pages
    return 200, {**as_dict(s), "messages": msgs}


def create_session(c, body):
    """body (all optional): {lang, explain_lang, level}.  Without them the session is German with Chinese explanations,
    exactly as before v0.2.  The language pair is fixed for the whole session (switching languages = new session)."""
    body = body if isinstance(body, dict) else {}
    lang = clean_lang(body["lang"]) if body.get("lang") else DEFAULT_LANG
    explain = clean_lang(body["explain_lang"], "explain_lang") if body.get("explain_lang") else DEFAULT_EXPLAIN_LANG
    level = clean_level(body.get("level"))
    t = now()
    cur = c.execute("INSERT INTO sessions(created_at, lang, explain_lang, level) VALUES (?, ?, ?, ?)", (t, lang, explain, level))
    return 201, {"id": cur.lastrowid, "created_at": t, "lang": lang, "explain_lang": explain, "level": level}


def patch_session(c, sid, body):
    sets, args = [], []
    for k in SESSION_FIELDS:
        if k in body:
            v = body[k]
            if k == "ended_at" and v == "now":
                v = now()
            if k == "level":
                v = clean_level(v)
            if v is not None and not isinstance(v, str):
                raise ApiError(400, "%s must be a string" % k)
            sets.append("%s = ?" % k)
            args.append(v)
    if not sets:
        raise ApiError(400, "nothing to update")
    cur = c.execute("UPDATE sessions SET %s WHERE id = ?" % ", ".join(sets), args + [sid])
    if cur.rowcount == 0:
        raise ApiError(404, "session not found")
    return 200, {"ok": True}


def count_words(text, lang=DEFAULT_LANG):
    """Words the way the page's tokenizer sees them: letters/digits, with ' ’ - inside a word (bin's, Hallo-Welt = 1 word).
    Languages written without spaces (Chinese, Japanese, Thai ...): every character of that script counts as one word,
    plus any Latin words mixed in."""
    text = text or ""
    if (lang or "").split("-")[0] in NO_SPACE_LANGS:
        n = len(NO_SPACE_CHAR_RE.findall(text))
        return n + len(WORD_RE.findall(NO_SPACE_CHAR_RE.sub(" ", text)))
    return len(WORD_RE.findall(text))


def delete_session(c, sid):
    # keep the numbers for the statistics before the messages disappear with the session (ON DELETE CASCADE)
    lang = session_lang(c, sid)
    rows = c.execute(
        "SELECT kind, content, is_correct, retyped, created_at, errors FROM messages WHERE session_id = ? AND role = 'user'", (sid,)
    ).fetchall()
    c.executemany(
        "INSERT INTO stat_archive(session_id, kind, words, is_correct, retyped, created_at, lang, errors) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(sid, r["kind"], count_words(r["content"], lang), r["is_correct"], r["retyped"], r["created_at"], lang, r["errors"]) for r in rows],
    )
    cur = c.execute("DELETE FROM sessions WHERE id = ?", (sid,))
    return 200, {"deleted": cur.rowcount}


def get_stats(c, qs=None):
    """One compact row per sentence the student wrote (live messages + archived ones of deleted sessions).
    The page groups them by the student's local day, so time zones and daylight saving are handled there.
    t = UTC time, k = kind, w = words, ok = 1/0/None (written correctly at the first try), r = times retyped, s = session,
    l = language learned, e = error type keys (list; [] = none or not checked).  ?lang=xx returns only that language."""
    lang = qs_lang(qs or {})
    out = []
    live = ("SELECT m.session_id, m.kind, m.content, m.is_correct, m.retyped, m.created_at, m.errors, s.lang FROM messages m "
            "JOIN sessions s ON s.id = m.session_id WHERE m.role = 'user'" + (" AND s.lang = ?" if lang else "") + " ORDER BY m.id")
    for r in c.execute(live, (lang,) if lang else ()):
        out.append({"t": r["created_at"], "k": r["kind"], "w": count_words(r["content"], r["lang"]), "ok": r["is_correct"],
                    "r": r["retyped"] or 0, "s": r["session_id"], "l": r["lang"], "e": split_errors(r["errors"])})
    arch = ("SELECT session_id, kind, words, is_correct, retyped, created_at, lang, errors FROM stat_archive"
            + (" WHERE lang = ?" if lang else "") + " ORDER BY id")
    for r in c.execute(arch, (lang,) if lang else ()):
        out.append({"t": r["created_at"], "k": r["kind"], "w": r["words"], "ok": r["is_correct"], "r": r["retyped"] or 0,
                    "s": r["session_id"], "l": r["lang"], "e": split_errors(r["errors"])})
    return 200, {"rows": out}


def split_errors(v):
    return [x for x in (v or "").split(",") if x]


def clean_field(k, v):
    if v is None:
        return None
    if k == "errors":                       # ["article", "word_order"] (or "article,word_order") -> "article,word_order"
        items = v.split(",") if isinstance(v, str) else v
        if not isinstance(items, list) or len(items) > 12 or \
                any(not isinstance(x, str) or not ERROR_KEY_RE.match(x.strip()) for x in items if x != ""):
            raise ApiError(400, "errors must be a list of at most 12 keys such as article, word_order")
        return ",".join(dict.fromkeys(x.strip() for x in items if x.strip()))
    if k == "extra":
        if isinstance(v, dict):
            v = json.dumps(v, ensure_ascii=False)
        if not isinstance(v, str) or len(v) > 20000:
            raise ApiError(400, "extra must be a JSON object (at most 20000 characters)")
        try:
            if not isinstance(json.loads(v), dict):
                raise ValueError
        except ValueError:
            raise ApiError(400, "extra must be a JSON object")
        return v
    if k == "is_correct":
        return 1 if v else 0
    if k == "retyped":
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= 1000:
            raise ApiError(400, "retyped must be a small integer")
        return v
    if not isinstance(v, str):
        raise ApiError(400, "%s must be a string" % k)
    return v


def source_alias(body):
    """v0.2 pages send the source sentence as "source"; it is stored in the old "zh" column."""
    if isinstance(body, dict) and "source" in body:
        body = dict(body)
        body["zh"] = body.pop("source")
    return body


def add_message(c, sid, body):
    body = source_alias(body)
    if not c.execute("SELECT 1 FROM sessions WHERE id = ?", (sid,)).fetchone():
        raise ApiError(404, "session not found")
    role, kind, content = body.get("role"), body.get("kind"), body.get("content")
    valid = (role == "user" and kind in USER_KINDS) or (role == "assistant" and kind in ASSISTANT_KINDS)
    if not valid:
        raise ApiError(400, "bad role/kind")
    if not isinstance(content, str) or not content.strip():
        raise ApiError(400, "content is required")
    cols, vals = ["session_id", "role", "kind", "content", "created_at"], [sid, role, kind, content, now()]
    for k in MSG_FIELDS:
        if k in body:
            cols.append(k)
            vals.append(clean_field(k, body[k]))
    cur = c.execute("INSERT INTO messages(%s) VALUES (%s)" % (", ".join(cols), ", ".join("?" * len(cols))), vals)
    if "is_correct" in body or "meaning" in body:
        review_after_answer(c, cur.lastrowid)
    return 201, {"id": cur.lastrowid, "created_at": vals[4]}


def patch_message(c, mid, body):
    body = source_alias(body)
    sets, args = [], []
    if "kind" in body:          # v0.2: a sentence recognised as practice turned out to be a question (the model said so)
        row = c.execute("SELECT role FROM messages WHERE id = ?", (mid,)).fetchone()
        if not row:
            raise ApiError(404, "message not found")
        if body["kind"] not in (USER_KINDS if row["role"] == "user" else ASSISTANT_KINDS):
            raise ApiError(400, "bad kind")
        sets.append("kind = ?")
        args.append(body["kind"])
    for k in MSG_FIELDS:
        if k in body:
            sets.append("%s = ?" % k)
            args.append(clean_field(k, body[k]))
    if not sets:
        raise ApiError(400, "nothing to update")
    cur = c.execute("UPDATE messages SET %s WHERE id = ?" % ", ".join(sets), args + [mid])
    if cur.rowcount == 0:
        raise ApiError(404, "message not found")
    review = review_after_answer(c, mid) if ("is_correct" in body or "meaning" in body) else None
    return 200, {"ok": True, **({"review": review} if review else {})}


# --------------------------------------------------------------------------- spaced review (v0.4)
def review_after_answer(c, mid):
    """A checked translation: wrong -> its exercise sentence goes into the review list (again tomorrow);
    the answer to a sentence already in the list moves it on (right) or back to the start (wrong).
    Returns what happened ({"id", "result": "added" | "again" | "next" | "done", "due_at"}) or None."""
    m = c.execute("SELECT m.id, m.kind, m.role, m.zh, m.focus, m.is_correct, m.meaning, s.lang, s.explain_lang "
                  "FROM messages m JOIN sessions s ON s.id = m.session_id WHERE m.id = ?", (mid,)).fetchone()
    if not m or m["role"] != "user" or m["kind"] != "translate" or m["is_correct"] is None or not (m["zh"] or "").strip():
        return None
    wrong = m["is_correct"] == 0 or m["meaning"] == "off"
    source = m["zh"].strip()
    r = c.execute("SELECT * FROM reviews WHERE lang = ? AND explain_lang = ? AND source = ?",
                  (m["lang"], m["explain_lang"], source)).fetchone()
    if r and r["last_msg_id"] >= mid:
        return None                                              # this answer was already counted
    if not r:
        if not wrong:
            return None
        due = now(REVIEW_DAYS[0])
        cur = c.execute("INSERT INTO reviews(lang, explain_lang, source, focus, step, due_at, n_wrong, last_msg_id, created_at) "
                        "VALUES (?, ?, ?, ?, 0, ?, 1, ?, ?)", (m["lang"], m["explain_lang"], source, m["focus"], due, mid, now()))
        return {"id": cur.lastrowid, "result": "added", "due_at": due}
    if r["done_at"] and not wrong:
        c.execute("UPDATE reviews SET last_msg_id = ?, n_right = n_right + 1 WHERE id = ?", (mid, r["id"]))
        return None
    if wrong:
        due = now(REVIEW_DAYS[0])
        c.execute("UPDATE reviews SET step = 0, due_at = ?, done_at = NULL, n_wrong = n_wrong + 1, last_msg_id = ? WHERE id = ?",
                  (due, mid, r["id"]))
        return {"id": r["id"], "result": "again", "due_at": due}
    step = r["step"] + 1
    if step >= len(REVIEW_DAYS):
        c.execute("UPDATE reviews SET step = ?, due_at = NULL, done_at = ?, n_right = n_right + 1, last_msg_id = ? WHERE id = ?",
                  (step, now(), mid, r["id"]))
        return {"id": r["id"], "result": "done", "due_at": None}
    due = now(REVIEW_DAYS[step])
    c.execute("UPDATE reviews SET step = ?, due_at = ?, n_right = n_right + 1, last_msg_id = ? WHERE id = ?",
              (step, due, mid, r["id"]))
    return {"id": r["id"], "result": "next", "due_at": due}


def add_report(c, body):
    """body: {kind, reason?, message_id?, note?, lang?, explain_lang?, level?}.  The text and grammar point are copied
    from the message; the model from the settings.  A bad exercise sentence also leaves the review list."""
    kind = body.get("kind")
    if kind not in REPORT_KINDS:
        raise ApiError(400, "kind must be one of: " + ", ".join(sorted(REPORT_KINDS)))
    reason = body.get("reason")
    if reason is not None and reason not in REPORT_KINDS[kind]:
        raise ApiError(400, "reason must be one of: " + ", ".join(sorted(REPORT_KINDS[kind])))
    note = body.get("note")
    if note is not None and (not isinstance(note, str) or len(note) > 2000):
        raise ApiError(400, "note must be a string of at most 2000 characters")
    mid = body.get("message_id")
    text = focus = None
    lang, explain = body.get("lang"), body.get("explain_lang")
    if mid is not None:
        if isinstance(mid, bool) or not isinstance(mid, int):
            raise ApiError(400, "message_id must be an integer")
        m = c.execute("SELECT m.content, m.focus, s.lang, s.explain_lang FROM messages m JOIN sessions s ON s.id = m.session_id "
                      "WHERE m.id = ?", (mid,)).fetchone()
        if not m:
            raise ApiError(404, "message not found")
        text, focus, lang, explain = m["content"], m["focus"], m["lang"], m["explain_lang"]
    lang = clean_lang(lang) if lang else None
    explain = clean_lang(explain, "explain_lang") if explain else None
    level = clean_level(body.get("level"))
    try:
        provider, prof = llm.active_profile(settings_file())
        model = prof.get("model", "")
    except Exception:
        provider = model = None
    cur = c.execute("INSERT INTO reports(created_at, kind, reason, message_id, text, focus, lang, explain_lang, level, provider, model, note) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (now(), kind, reason, mid, text, focus, lang, explain, level, provider, model, (note or "").strip() or None))
    if kind == "bad_exercise" and text and lang and explain:     # no point in reviewing a broken sentence
        c.execute("UPDATE reviews SET done_at = ?, due_at = NULL WHERE lang = ? AND explain_lang = ? AND source = ? AND done_at IS NULL",
                  (now(), lang, explain, text.strip()))
    return 201, {"id": cur.lastrowid}


def list_reports(c, qs):
    where, args = [], []
    if qs.get("kind"):
        where.append("kind = ?"); args.append(qs["kind"])
    rows = c.execute("SELECT * FROM reports" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY id DESC LIMIT ?",
                     args + [as_int(qs, "limit", 200, 1, 2000)]).fetchall()
    return 200, [as_dict(r) for r in rows]


def get_reviews(c, qs):
    """?lang=&explain= (both optional).  {"due": [{id, source, focus, step, due_at}, ...] (oldest first, at most ?limit=),
    "counts": {"due", "waiting", "done"}}"""
    where, args = [], []
    lang, explain = qs_lang(qs), qs_explain(qs)
    if lang:
        where.append("lang = ?"); args.append(lang)
    if explain:
        where.append("explain_lang = ?"); args.append(explain)
    w = (" AND " + " AND ".join(where)) if where else ""
    t = now()
    due = [as_dict(r) for r in c.execute(
        "SELECT id, lang, explain_lang, source, focus, step, due_at FROM reviews WHERE done_at IS NULL AND due_at <= ?" + w +
        " ORDER BY due_at, id LIMIT ?", [t] + args + [as_int(qs, "limit", 20, 1, 200)])]
    n = lambda cond, extra=(): c.execute("SELECT COUNT(*) FROM reviews WHERE " + cond + w, list(extra) + args).fetchone()[0]
    counts = {"due": n("done_at IS NULL AND due_at <= ?", (t,)), "waiting": n("done_at IS NULL AND due_at > ?", (t,)),
              "done": n("done_at IS NOT NULL")}
    return 200, {"due": due, "counts": counts}


def remove_review(c, rid):
    """The student does not want this sentence back ("remove from review"): it counts as done."""
    cur = c.execute("UPDATE reviews SET done_at = ?, due_at = NULL WHERE id = ? AND done_at IS NULL", (now(), rid))
    if cur.rowcount == 0 and not c.execute("SELECT 1 FROM reviews WHERE id = ?", (rid,)).fetchone():
        raise ApiError(404, "review not found")
    return 200, {"ok": True}


def close_stale(c):
    """Called when the page opens: end sessions that were left open (tab closed, crash ...), drop empty ones,
    and report which ended sessions still need a title/summary."""
    c.execute("DELETE FROM sessions WHERE id NOT IN (SELECT DISTINCT session_id FROM messages)")
    c.execute(
        "UPDATE sessions SET ended_at = COALESCE((SELECT MAX(created_at) FROM messages WHERE session_id = sessions.id), created_at) "
        "WHERE ended_at IS NULL"
    )
    rows = c.execute("SELECT id FROM sessions WHERE title = '' ORDER BY id DESC LIMIT 20").fetchall()
    return 200, {"need_summary": [r["id"] for r in rows]}


def data_dir():
    return os.path.dirname(DB_PATH)


def recent_prompts(c, n, lang=None, explain=None):
    """The newest exercise sentences (every status: answered, skipped or still pending), newest first.
    lang: only sessions learning that language; explain: only sessions whose sentences are written in that
    language (None = all)."""
    where, args = "", []
    if lang:
        where += " AND s.lang = ?"
        args.append(lang)
    if explain:
        where += " AND s.explain_lang = ?"
        args.append(explain)
    return [as_dict(r) for r in c.execute(
        "SELECT m.id, m.session_id, m.content, m.status, m.focus, m.created_at FROM messages m "
        "JOIN sessions s ON s.id = m.session_id WHERE m.role = 'assistant' AND m.kind = 'prompt'"
        + where + " ORDER BY m.id DESC LIMIT ?", args + [n])]


def qs_explain(qs):
    return clean_lang(qs["explain"], "explain") if qs.get("explain") else None


def get_recent_prompts(c, qs):
    return 200, recent_prompts(c, as_int(qs, "n", 30, 1, 500), qs_lang(qs), qs_explain(qs))


def foci_for(c, lang, group=None):
    """The grammar points of a language.  group (A1 ... C1): only that level plus the points without a level;
    a language whose list has no levels at all always returns everything."""
    if group:
        return [r["focus"] for r in c.execute(
            "SELECT focus FROM grammar_foci WHERE lang = ? AND (level = ? OR level IS NULL) ORDER BY pos", (lang, group))]
    return [r["focus"] for r in c.execute("SELECT focus FROM grammar_foci WHERE lang = ? ORDER BY pos", (lang,))]


def has_levels(c, lang):
    return bool(c.execute("SELECT 1 FROM grammar_foci WHERE lang = ? AND level IS NOT NULL", (lang,)).fetchone())


def level_lists(c, lang, level):
    """(current level's points, the level below's points, group) for the generator; without levels: (all, [], None)."""
    group = topics.level_group(level) if has_levels(c, lang) else None
    if not group:
        return foci_for(c, lang), [], None
    low = topics.lower_group(group)
    lower = [r["focus"] for r in c.execute("SELECT focus FROM grammar_foci WHERE lang = ? AND level = ? ORDER BY pos", (lang, low))] if low else []
    return foci_for(c, lang, group), lower, group


def get_foci(c, qs):
    """?lang= (&level=A1 ... C2: only that level's list).  items = every point with its level (NULL = all levels)."""
    lang = qs_lang(qs) or DEFAULT_LANG
    level = clean_level(qs.get("level")) if qs.get("level") else None
    group = topics.level_group(level) if level and has_levels(c, lang) else None
    items = [{"focus": r["focus"], "level": r["level"]} for r in c.execute(
        "SELECT focus, level FROM grammar_foci WHERE lang = ? ORDER BY pos", (lang,))]
    return 200, {"lang": lang, "level": level, "group": group, "foci": foci_for(c, lang, group), "items": items,
                 "leveled": any(i["level"] for i in items)}


def put_foci(c, body):
    """Replace the grammar-point list of one language: {lang, foci: ["...", {"focus": "...", "level": "B1"}, ...]}
    (1-150 items, each at most 120 chars; level A1 A2 B1 B2 C1, or none = every level)."""
    lang = clean_lang(body.get("lang"))
    foci = body.get("foci")
    rows = []
    for f in foci if isinstance(foci, list) else []:
        text, lv = (f.get("focus"), f.get("level")) if isinstance(f, dict) else (f, None)
        if not isinstance(text, str) or not text.strip() or len(text) > 120 or (lv is not None and lv not in topics.LEVEL_GROUPS):
            rows = None
            break
        rows.append((text.strip(), lv))
    if not rows or not 1 <= len(rows) <= 150:
        raise ApiError(400, "foci must be a list of 1-150 non-empty strings (or {focus, level}) of at most 120 characters")
    c.execute("DELETE FROM grammar_foci WHERE lang = ?", (lang,))
    c.executemany("INSERT INTO grammar_foci(lang, pos, focus, level) VALUES (?, ?, ?, ?)", [(lang, i, f, lv) for i, (f, lv) in enumerate(rows)])
    return 200, {"lang": lang, "foci": foci_for(c, lang)}


def foci_progress(c, qs):
    """Statistics: the grammar points of ?lang= at ?level= with how often each was answered and whether the newest
    answer was right.  {"group", "items": [{focus, n, ok, last_ok}]}"""
    lang = qs_lang(qs) or DEFAULT_LANG
    level = clean_level(qs.get("level")) if qs.get("level") else None
    cur, _, group = level_lists(c, lang, level)
    stats = {f: {"focus": f, "n": 0, "ok": 0, "last_ok": None} for f in cur}
    for r in c.execute("SELECT m.focus, m.is_correct, m.meaning FROM messages m JOIN sessions s ON s.id = m.session_id "
                       "WHERE s.lang = ? AND m.role = 'user' AND m.kind = 'translate' AND m.is_correct IS NOT NULL "
                       "AND m.focus IS NOT NULL ORDER BY m.id", (lang,)):
        st = stats.get(r["focus"])
        if st:
            right = r["is_correct"] == 1 and r["meaning"] != "off"
            st["n"] += 1
            st["ok"] += right
            st["last_ok"] = right
    return 200, {"lang": lang, "level": level, "group": group, "items": list(stats.values())}


def get_languages(c):
    """Every language pair that has sessions, with how many (for the history / statistics filters)."""
    rows = c.execute("SELECT lang, explain_lang, COUNT(*) AS n, MAX(created_at) AS last FROM sessions "
                     "GROUP BY lang, explain_lang ORDER BY last DESC").fetchall()
    return 200, [as_dict(r) for r in rows]


def topics_cooldown(c, qs):
    """What the generator should avoid: topic words of the last WINDOW questions, and the grammar points that have
    not been used for the longest time (never-used first)."""
    cfg = topics.CONFIG
    lang = qs_lang(qs)                                  # None = all languages (what pages before v0.2 get)
    explain = qs_explain(qs)                            # the language the exercise sentences are written in
    sw = topics.load_stopwords(ROOT, cfg, explain or DEFAULT_EXPLAIN_LANG)
    level = clean_level(qs.get("level")) if qs.get("level") else None     # v0.5: pages send the chosen level
    cur, lower, group = level_lists(c, lang or DEFAULT_LANG, level)
    foci = cur + [f for f in lower if f not in cur]
    k = as_int(qs, "k", 5, 1, max(1, len(foci)))
    topic = (qs.get("topic") or "")[:200]
    rep = topics.cooldown_report([r["content"] for r in recent_prompts(c, cfg["WINDOW"], lang, explain)], sw, cfg, topic)
    last = {r["focus"]: r["m"] for r in c.execute(
        "SELECT m.focus, MAX(m.id) AS m FROM messages m JOIN sessions s ON s.id = m.session_id "
        "WHERE m.kind = 'prompt' AND m.focus IS NOT NULL" + (" AND s.lang = ?" if lang else "") + " GROUP BY m.focus",
        (lang,) if lang else ())}
    lang_sql, lang_arg = (" AND s.lang = ?", (lang,)) if lang else ("", ())
    answers = [(r["focus"], r["is_correct"] == 0 or r["meaning"] == "off") for r in c.execute(
        "SELECT m.focus, m.is_correct, m.meaning FROM messages m JOIN sessions s ON s.id = m.session_id "
        "WHERE m.role = 'user' AND m.kind = 'translate' AND m.focus IS NOT NULL AND m.is_correct IS NOT NULL" + lang_sql +
        " ORDER BY m.id DESC LIMIT 500", lang_arg)]
    recent_foci = [r["focus"] for r in c.execute(
        "SELECT m.focus FROM messages m JOIN sessions s ON s.id = m.session_id WHERE m.kind = 'prompt'" + lang_sql +
        " ORDER BY m.id DESC LIMIT 20", lang_arg)]
    rep["weak"] = [f for f in topics.weak_foci([a for a in answers if a[0] in foci], recent_foci, cfg)]
    rep["foci"] = topics.mix_foci(topics.rank_foci(last, len(cur), cur), topics.rank_foci(last, len(lower), lower),
                                  k, rep["weak"], cfg["LOWER_EVERY"]) if foci else []
    rep["group"] = group
    rep["lang"] = lang or DEFAULT_LANG
    rep["config"] = dict(cfg)
    if sw.missing_general:
        rep["warnings"] = ["the stop word file for '%s' was not found next to server.py: topic words will be noisier"
                           % (explain or DEFAULT_EXPLAIN_LANG)]
    return 200, rep


def _clean_texts(v, what, limit=50):
    if v is None:
        return []
    if not isinstance(v, list) or len(v) > limit:
        raise ApiError(400, "%s must be a list of at most %d items" % (what, limit))
    for x in v:
        item = x.get("zh") if isinstance(x, dict) else x
        if not isinstance(item, str) or len(item) > 600:
            raise ApiError(400, "%s: every item must be a string (or an object with a string 'zh') of at most 600 characters" % what)
    return v


def topics_filter(c, body):
    """Drops candidate sentences that share a (non-generic) topic word with the recent questions.
    body: {candidates, context?, topic?, force_if_empty?, round?}.  Every rejection is logged with the words that hit."""
    cfg = topics.CONFIG
    cands = _clean_texts(body.get("candidates"), "candidates")
    context = [x if isinstance(x, str) else x.get("zh") for x in _clean_texts(body.get("context"), "context")]
    topic = body.get("topic") if isinstance(body.get("topic"), str) else ""
    lang = clean_lang(body["lang"]) if body.get("lang") else None
    explain = clean_lang(body["explain_lang"], "explain_lang") if body.get("explain_lang") else None
    sw = topics.load_stopwords(ROOT, cfg, explain or DEFAULT_EXPLAIN_LANG)
    recent = [r["content"] for r in recent_prompts(c, cfg["WINDOW"], lang, explain)]
    res = topics.filter_candidates(cands, recent, sw, cfg, context, topic[:200], bool(body.get("force_if_empty")))
    rnd = body.get("round") if isinstance(body.get("round"), int) else None
    topics.append_log(data_dir(), {"event": "filter", "round": rnd, "topic": topic[:60], "window": len(recent),
                                   "candidates": len(cands), "kept": len(res["kept"]), "dropped": len(res["dropped"]),
                                   "forced": res["forced"]})
    for d in res["dropped"]:
        topics.append_log(data_dir(), {"event": "drop", "round": rnd, "zh": d["zh"], "hits": d["hits"], "hit_words": d["hit_words"]})
    if res["forced"]:
        topics.append_log(data_dir(), {"event": "forced", "round": rnd, "zh": res["kept"][0]["zh"]})
    return 200, res


USAGE_FILE = "usage_log.jsonl"


def log_usage(tag, usage):
    """One line per model call with the token counts the service reported (numbers only, never any text)."""
    try:
        name, prof = llm.active_profile(settings_file())
        rec = {"ts": now(), "provider": name, "model": prof.get("model", ""), "dedupe": llm.topic_dedupe(settings_file()),
               "tag": tag if isinstance(tag, str) else "", **(usage or {})}
        with open(os.path.join(data_dir(), USAGE_FILE), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except (OSError, ValueError):
        pass


def route_llm(method, p, body):
    """Routes that need no database connection (they can take minutes)."""
    try:
        if p == ["settings"]:
            if method == "GET":
                return 200, llm.public(settings_file())
            if method == "PUT":
                return 200, llm.update(settings_file(), body)
        if p == ["llm", "test"] and method == "POST":
            return 200, llm.test(settings_file())
        if p == ["llm", "chat"] and method == "POST":
            temp = body.get("temperature")
            text, usage = llm.chat_with_usage(settings_file(), body.get("messages"), 0.2 if temp is None else temp,
                                              body.get("schema"), body.get("effort"), body.get("timeout"))
            log_usage((body.get("tag") or "")[:24] if isinstance(body.get("tag"), str) else "", usage)
            return 200, {"content": text, "usage": usage}
    except llm.LlmError as e:
        code = 400 if e.kind == "config" else 502
        return code, {"error": e.msg, "kind": e.kind, "status": e.status}
    except (TypeError, ValueError) as e:
        return 400, {"error": "bad request: %s" % e}
    return None


def route(c, method, parts, qs, body):
    p = parts[1:]           # parts[0] == "api"
    if method == "GET" and p == ["health"]:
        n = c.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
        return 200, {"ok": True, "sessions": n, "db": DB_PATH, "version": VERSION}
    if p == ["sessions"]:
        if method == "GET":
            return list_sessions(c, qs)
        if method == "POST":
            return create_session(c, body)
    if p == ["sessions", "close-stale"] and method == "POST":
        return close_stale(c)
    if p == ["stats"] and method == "GET":
        return get_stats(c, qs)
    if p == ["languages"] and method == "GET":
        return get_languages(c)
    if p == ["foci"]:
        if method == "GET":
            return get_foci(c, qs)
        if method == "PUT":
            return put_foci(c, body)
    if p == ["foci", "progress"] and method == "GET":
        return foci_progress(c, qs)
    if p == ["prompts", "recent"] and method == "GET":
        return get_recent_prompts(c, qs)
    if p == ["topics", "cooldown"] and method == "GET":
        return topics_cooldown(c, qs)
    if p == ["topics", "filter"] and method == "POST":
        return topics_filter(c, body)
    if p == ["reports"]:
        if method == "POST":
            return add_report(c, body)
        if method == "GET":
            return list_reports(c, qs)
    if p == ["reviews"] and method == "GET":
        return get_reviews(c, qs)
    if len(p) == 2 and p[0] == "reviews" and p[1].isdigit() and method == "DELETE":
        return remove_review(c, int(p[1]))
    if len(p) >= 2 and p[0] == "sessions" and p[1].isdigit():
        sid = int(p[1])
        if len(p) == 2:
            if method == "GET":
                return get_session(c, sid)
            if method == "PATCH":
                return patch_session(c, sid, body)
            if method == "DELETE":
                return delete_session(c, sid)
        if len(p) == 3 and p[2] == "messages" and method == "POST":
            return add_message(c, sid, body)
    if len(p) == 2 and p[0] == "messages" and p[1].isdigit() and method == "PATCH":
        return patch_message(c, int(p[1]), body)
    raise ApiError(404, "unknown endpoint")


# --------------------------------------------------------------------------- http
class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **STATIC_TYPES}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB, **kwargs)

    def _send(self, code, ctype, data):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, code, obj):
        self._send(code, "application/json; charset=utf-8", json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    # ---- JSON API ----
    def _api(self, method):
        u = urlparse(self.path)
        parts = [x for x in u.path.split("/") if x]
        qs = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            raw = self._body()
            try:
                body = json.loads(raw.decode("utf-8")) if raw else {}
            except ValueError:
                raise ApiError(400, "invalid JSON")
            if not isinstance(body, dict):
                raise ApiError(400, "JSON object expected")
            ui = (self.headers.get("X-UI-Lang") or "").strip().lower()
            llm.ui.lang = ui if ui in llm.LANGS else "zh"         # language of the messages llm.py returns
            done = route_llm(method, parts[1:], body)
            if done is not None:
                self._json(*done)
                return
            with closing(connect()) as c:
                code, obj = route(c, method, parts, qs, body)
                c.commit()
        except ApiError as e:
            code, obj = e.code, {"error": e.msg}
        except Exception as e:
            traceback.print_exc()
            code, obj = 500, {"error": str(e)}
        self._json(code, obj)

    def _guard(self, method):
        """The API holds the API key and can spend money, so refuse anything that is not the page itself:
        wrong Host (DNS rebinding), foreign Origin (another website), or a body without a JSON content type
        (which a foreign page could send without a CORS pre-flight)."""
        allowed = {"127.0.0.1:%d" % PORT, "localhost:%d" % PORT, "[::1]:%d" % PORT}
        if self.headers.get("Host", "") not in allowed:
            return "bad host"
        origin = self.headers.get("Origin")
        if origin and origin not in {"http://" + a for a in allowed}:
            return "foreign origin"
        if method in ("POST", "PUT", "PATCH") and int(self.headers.get("Content-Length") or 0) \
                and "application/json" not in self.headers.get("Content-Type", ""):
            return "JSON content type required"
        return None

    def _dispatch(self, method):
        if self.path.startswith("/api/"):
            bad = self._guard(method)
            if bad:
                self._json(403, {"error": bad})
            else:
                self._api(method)
            return True
        return False

    def do_GET(self):
        if self._dispatch("GET"):
            return
        path = urlparse(self.path).path
        if path == "/":
            path = self.path = "/index.html"
        # only the page's own files under web/ (never data/, settings.json or *.py); no "..", no hidden files
        if os.path.splitext(path)[1] in STATIC_TYPES and ".." not in path and "/." not in path:
            super().do_GET()
        else:
            self.send_error(404)

    def do_HEAD(self):
        self.send_error(405)

    def do_PUT(self):
        if not self._dispatch("PUT"):
            self.send_error(404)

    def do_POST(self):
        if not self._dispatch("POST"):
            self.send_error(404)

    def do_PATCH(self):
        if not self._dispatch("PATCH"):
            self.send_error(404)

    def do_DELETE(self):
        if not self._dispatch("DELETE"):
            self.send_error(404)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # always load the newest index.html
        super().end_headers()

    def log_message(self, fmt, *args):
        pass    # keep the console quiet; errors are printed with a traceback above


def pick_db_path():
    """data/german.db next to this file; if that folder is not writable, fall back to the user's home folder."""
    global DB_PATH
    try:
        init_db()
        return
    except (OSError, sqlite3.Error) as e:
        if os.environ.get("SW_DB"):
            raise
        alt = os.path.join(os.path.expanduser("~"), "Schreibwerkstatt", "german.db")
        print("  ! Cannot use %s (%s)" % (DB_PATH, e))
        print("  ! Falling back to %s" % alt)
        DB_PATH = alt
        init_db()


if __name__ == "__main__":
    try:                                    # a Windows console with a legacy code page must not crash on print()
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    print("Schreibwerkstatt starting ... (Python %s, SQLite %s)" % (sys.version.split()[0], sqlite3.sqlite_version))
    try:
        pick_db_path()
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as e:
        print("")
        print("ERROR: cannot start: %s" % e)
        if getattr(e, "errno", None) in (98, 10048, 10013):
            print("Port %d is already in use - probably an old Schreibwerkstatt window is still open." % PORT)
            print("Close it, or set another port:  set SW_PORT=8001  before running run.bat")
        sys.exit(1)
    url = "http://%s:%d/" % (HOST, PORT)
    print("Schreibwerkstatt: " + url)
    print("  Data:     %s   (german.db + settings.json)" % os.path.dirname(DB_PATH))
    print("  Press Ctrl+C (or close this window) to stop.")
    sys.stdout.flush()
    if not os.environ.get("SW_NO_BROWSER"):
        import threading, webbrowser
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()   # the socket is already listening, so no race
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
