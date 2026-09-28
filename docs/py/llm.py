"""Model access for Schreibwerkstatt (standard library only).

The page never talks to a model directly.  It calls  POST /api/llm/chat  on server.py, which
reads the saved settings (including the API key) and speaks the right protocol:

    ollama     Ollama's own API      POST {base}/api/chat
    openai     OpenAI-compatible     POST {base}/chat/completions   (OpenAI, DeepSeek, Qwen/DashScope,
                                     OpenRouter, Groq, Gemini's compat endpoint, LM Studio, ...)
    anthropic  Anthropic Messages    POST {base}/v1/messages
    deepseek   DeepSeek (own entry)  POST {base}/chat/completions   OpenAI format plus DeepSeek's own switches:
                                     thinking on/off, JSON output; its own key, so it does not share the OpenAI one

Keeping the key here (not in the page) means it never reaches the browser or its storage.
"""
import json
import os
import socket
import threading
from urllib import error as urlerror, request as urlrequest
from urllib.parse import urlparse

USER_AGENT = "Schreibwerkstatt/1.0"

PROVIDERS = {
    "ollama": {"label": "Ollama", "base": "http://localhost:11434", "model": "gpt-oss:20b", "think": "low"},
    "openai": {"label": "OpenAI 兼容", "base": "https://api.openai.com/v1", "model": "", "think": "off", "preset": "openai"},
    "anthropic": {"label": "Anthropic", "base": "https://api.anthropic.com", "model": "", "think": "off"},
    # https://api-docs.deepseek.com (checked 2026-09): models deepseek-flash (cheap, fast) and deepseek-v4-pro;
    # thinking mode is ON by default there, so "off" here sends thinking: disabled (much faster for this app)
    "deepseek": {"label": "DeepSeek", "base": "https://api.deepseek.com", "model": "deepseek-flash", "think": "off"},
}
OPENAI_STYLE = ("openai", "deepseek")    # speak the OpenAI chat format and offer GET {base}/models
EFFORTS = ("off", "low", "medium", "high")
DEDUPE_MODES = ("local", "summary")      # how the exercise generator avoids repeating topics (see topics.py)
LEARN_LANGS = ("de", "en", "zh", "fr")   # languages that can be learned
LANGS = ("de", "en", "zh")               # languages for explanations / the interface (also what X-UI-Lang may be)
LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
_lock = threading.Lock()

# ---------------------------------------------------------------------------- messages in the interface language
# server.py sets ui.lang for each request (the page sends its interface language in the X-UI-Lang header).
ui = threading.local()
MSG = {
    "bad_base":   {"zh": "地址必须以 http:// 或 https:// 开头", "en": "The address must start with http:// or https://",
                   "de": "Die Adresse muss mit http:// oder https:// beginnen"},
    "timeout":    {"zh": "模型响应超时（超过 %d 秒）。可以调低推理强度，或换一个更快的模型。",
                   "en": "The model did not answer in time (more than %d seconds). Try a lower reasoning effort or a faster model.",
                   "de": "Das Modell hat nicht rechtzeitig geantwortet (mehr als %d Sekunden). Versuche eine niedrigere Denkstufe oder ein schnelleres Modell."},
    "network":    {"zh": "无法连接 %s（%s）", "en": "Cannot connect to %s (%s)", "de": "Keine Verbindung zu %s (%s)"},
    "not_json":   {"zh": "服务返回的不是 JSON（地址可能填错了）：", "en": "The service did not return JSON (the address may be wrong): ",
                   "de": "Der Dienst hat kein JSON zurückgegeben (die Adresse ist vielleicht falsch): "},
    "auth":       {"zh": "服务返回 %s：API Key 无效、已过期或没有权限。（%s）", "en": "The service returned %s: the API key is invalid, expired or lacks permission. (%s)",
                   "de": "Der Dienst meldet %s: Der API-Key ist ungültig, abgelaufen oder hat keine Berechtigung. (%s)"},
    "rate":       {"zh": "服务返回 429：请求太频繁或额度用完。（%s）", "en": "The service returned 429: too many requests or the quota is used up. (%s)",
                   "de": "Der Dienst meldet 429: zu viele Anfragen oder das Kontingent ist aufgebraucht. (%s)"},
    "notfound":   {"zh": "服务返回 404：地址或模型名可能填错了。（%s）", "en": "The service returned 404: the address or the model name may be wrong. (%s)",
                   "de": "Der Dienst meldet 404: Adresse oder Modellname sind vielleicht falsch. (%s)"},
    "http":       {"zh": "服务返回错误 %s：%s", "en": "The service returned error %s: %s", "de": "Der Dienst meldet Fehler %s: %s"},
    "need_model": {"zh": "还没有填写模型名。点右上角的状态按钮，在设置里填写。", "en": "No model name yet. Click the status button at the top right and enter one in the settings.",
                   "de": "Noch kein Modellname. Klicke oben rechts auf den Status und trage ihn in den Einstellungen ein."},
    "need_key":   {"zh": "还没有填写 API Key。点右上角的状态按钮，在设置里填写。", "en": "No API key yet. Click the status button at the top right and enter it in the settings.",
                   "de": "Noch kein API-Key. Klicke oben rechts auf den Status und trage ihn in den Einstellungen ein."},
    "s_no_key":   {"zh": "缺少 API Key", "en": "API key missing", "de": "API-Key fehlt"},
    "n_no_key":   {"zh": "还没有填写 API Key。", "en": "No API key has been entered yet.", "de": "Es wurde noch kein API-Key eingetragen."},
    "n_no_list":  {"zh": "已填写，但这个服务不提供模型列表，没法提前验证；发第一句话时才会知道能不能用。",
                   "en": "Saved, but this service offers no model list, so it cannot be checked in advance; you will know when you send the first sentence.",
                   "de": "Gespeichert, aber dieser Dienst bietet keine Modellliste, daher lässt es sich nicht vorab prüfen; beim ersten Satz zeigt sich, ob es klappt."},
    "s_no_model": {"zh": "未选择模型", "en": "No model chosen", "de": "Kein Modell gewählt"},
    "n_no_model": {"zh": "还没有填写模型名。", "en": "No model name has been entered yet.", "de": "Es wurde noch kein Modellname eingetragen."},
    "s_auth":     {"zh": "Key 无效", "en": "Invalid key", "de": "Key ungültig"},
    "s_network":  {"zh": "未连接", "en": "Not connected", "de": "Nicht verbunden"},
    "s_timeout":  {"zh": "超时", "en": "Timed out", "de": "Zeitüberschreitung"},
    "s_error":    {"zh": "出错", "en": "Error", "de": "Fehler"},
    "n_pick":     {"zh": "连接正常，但还没有选择模型。", "en": "Connected, but no model has been chosen yet.", "de": "Verbunden, aber noch kein Modell gewählt."},
    "n_models":   {"zh": "可用模型：", "en": " Available models: ", "de": " Verfügbare Modelle: "},
    "n_ol_miss":  {"zh": "已连接 Ollama，但没有找到模型「%s」。已安装：%s", "en": "Connected to Ollama, but the model “%s” was not found. Installed: %s",
                   "de": "Mit Ollama verbunden, aber das Modell „%s“ wurde nicht gefunden. Installiert: %s"},
    "n_miss":     {"zh": "连接正常，但服务的模型列表里没有「%s」。如果你确定名字没错，可以忽略。",
                   "en": "Connected, but “%s” is not in the service's model list. If you are sure the name is right, ignore this.",
                   "de": "Verbunden, aber „%s“ steht nicht in der Modellliste des Dienstes. Wenn der Name sicher stimmt, kannst du das ignorieren."},
    "n_ol_empty": {"zh": "已连接 Ollama，但还没有安装任何模型。", "en": "Connected to Ollama, but no model is installed yet.",
                   "de": "Mit Ollama verbunden, aber es ist noch kein Modell installiert."},
    "openai_lbl": {"zh": "OpenAI 兼容", "en": "OpenAI-compatible", "de": "OpenAI-kompatibel"},
    "list_sep":   {"zh": "、", "en": ", ", "de": ", "},
}


def T(key):
    """The message in the interface language of the current request (Chinese if unknown)."""
    lang = getattr(ui, "lang", "zh")
    m = MSG[key]
    return m.get(lang) or m["zh"]


def labels():
    return {k: (T("openai_lbl") if k == "openai" else v["label"]) for k, v in PROVIDERS.items()}


class LlmError(Exception):
    """kind: network | timeout | auth | notfound | rate | http | config"""

    def __init__(self, kind, msg, status=None):
        super().__init__(msg)
        self.kind, self.msg, self.status = kind, msg, status


# --------------------------------------------------------------------------- settings file
def _defaults():
    return {"active": "ollama", "source": "auto", "topic_dedupe": "local", "learn_lang": "de", "explain_lang": "zh", "level": "B2",
            "profiles": {k: dict(v) for k, v in PROVIDERS.items()}}


def _clean_profile(name, raw):
    p = dict(PROVIDERS[name])
    p["api_key"] = ""
    if isinstance(raw, dict):
        for k in ("base", "model", "think", "preset", "api_key"):
            v = raw.get(k)
            if isinstance(v, str) and (k in p or k == "api_key"):
                p[k] = v.strip()[:500]
    if p["think"] not in EFFORTS:
        p["think"] = PROVIDERS[name]["think"]
    p["base"] = p["base"].rstrip("/") or PROVIDERS[name]["base"]
    if name == "ollama":
        p.pop("preset", None)
    return p


def load(path):
    """Returns (settings, existed).  A damaged file is kept as settings.json.bad and treated as empty."""
    s, existed = _defaults(), False
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
        existed = True
        if isinstance(raw, dict):
            if raw.get("active") in PROVIDERS:
                s["active"] = raw["active"]
            if raw.get("source") in ("auto", "mock"):
                s["source"] = raw["source"]
            if raw.get("topic_dedupe") in DEDUPE_MODES:
                s["topic_dedupe"] = raw["topic_dedupe"]
            for k, allowed in (("learn_lang", LEARN_LANGS), ("explain_lang", LANGS), ("level", LEVELS)):
                if raw.get(k) in allowed:
                    s[k] = raw[k]
            for name in PROVIDERS:
                s["profiles"][name] = _clean_profile(name, (raw.get("profiles") or {}).get(name))
    except FileNotFoundError:
        pass
    except (ValueError, OSError):
        try:
            os.replace(path, path + ".bad")
        except OSError:
            pass
    for name in PROVIDERS:
        s["profiles"][name] = _clean_profile(name, s["profiles"][name])
    return s, existed


def _write(path, s):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=2)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)


def public(path):
    """The settings as the page may see them: the key is replaced by has_key."""
    with _lock:
        s, existed = load(path)
    out = {"active": s["active"], "source": s["source"], "topic_dedupe": s["topic_dedupe"], "fresh": not existed, "file": path,
           "learn_lang": s["learn_lang"], "explain_lang": s["explain_lang"], "level": s["level"],
           "labels": labels(), "profiles": {}}
    for name, p in s["profiles"].items():
        q = {k: v for k, v in p.items() if k != "api_key"}
        q["has_key"] = bool(p.get("api_key"))
        out["profiles"][name] = q
    return out


def update(path, body):
    """body: {active?, source?, profile?: {provider, base?, model?, think?, preset?, api_key?}}
    api_key: absent = keep, "" = clear."""
    with _lock:
        s, _ = load(path)
        if "active" in body:
            if body["active"] not in PROVIDERS:
                raise LlmError("config", "unknown provider")
            s["active"] = body["active"]
        if "source" in body:
            if body["source"] not in ("auto", "mock"):
                raise LlmError("config", "unknown source")
            s["source"] = body["source"]
        if "topic_dedupe" in body:
            if body["topic_dedupe"] not in DEDUPE_MODES:
                raise LlmError("config", "unknown topic_dedupe")
            s["topic_dedupe"] = body["topic_dedupe"]
        for k, allowed in (("learn_lang", LEARN_LANGS), ("explain_lang", LANGS), ("level", LEVELS)):
            if k in body:
                if body[k] not in allowed:
                    raise LlmError("config", "%s must be one of %s" % (k, ", ".join(allowed)))
                s[k] = body[k]
        pr = body.get("profile")
        if pr is not None:
            if not isinstance(pr, dict) or pr.get("provider") not in PROVIDERS:
                raise LlmError("config", "unknown provider")
            name = pr["provider"]
            cur = s["profiles"][name]
            for k in ("base", "model", "think", "preset", "api_key"):
                if k in pr:
                    if not isinstance(pr[k], str):
                        raise LlmError("config", "%s must be a string" % k)
                    cur[k] = pr[k]
            if "base" in pr and pr["base"].strip() and not pr["base"].strip().lower().startswith(("http://", "https://")):
                raise LlmError("config", T("bad_base"))
            s["profiles"][name] = _clean_profile(name, cur)
        _write(path, s)
    return public(path)


def active_profile(path):
    with _lock:
        s, _ = load(path)
    return s["active"], s["profiles"][s["active"]]


def topic_dedupe(path):
    with _lock:
        s, _ = load(path)
    return s["topic_dedupe"]


# --------------------------------------------------------------------------- http helpers
def _err_text(body):
    """Pull the human-readable message out of an error body from any of the three APIs."""
    try:
        j = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        return body.decode("utf-8", "replace")[:300]
    e = j.get("error", j) if isinstance(j, dict) else j
    if isinstance(e, dict):
        e = e.get("message") or e.get("detail") or json.dumps(e, ensure_ascii=False)
    return str(e)[:600]


def _http(method, url, headers=None, payload=None, timeout=180):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    h = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if data is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    req = urlrequest.Request(url, data=data, method=method, headers=h)
    try:
        with urlrequest.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urlerror.HTTPError as e:
        msg = _err_text(e.read())
        kind = {401: "auth", 403: "auth", 404: "notfound", 429: "rate"}.get(e.code, "http")
        raise LlmError(kind, msg, e.code)
    except (socket.timeout, TimeoutError):
        raise LlmError("timeout", T("timeout") % timeout)
    except urlerror.URLError as e:
        if isinstance(e.reason, (socket.timeout, TimeoutError)):
            raise LlmError("timeout", T("timeout") % timeout)
        raise LlmError("network", T("network") % (urlparse(url).netloc, e.reason))
    except OSError as e:
        raise LlmError("network", T("network") % (urlparse(url).netloc, e))
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError:
        raise LlmError("http", T("not_json") + raw[:200].decode("utf-8", "replace"))


def _friendly(e, prof_name):
    """Add the hint a person needs to the raw error."""
    if e.kind == "auth":
        e.msg = T("auth") % (e.status, e.msg)
    elif e.kind == "rate":
        e.msg = T("rate") % e.msg
    elif e.kind == "notfound" and prof_name != "ollama":
        e.msg = T("notfound") % e.msg
    elif e.kind == "http":
        e.msg = T("http") % (e.status, e.msg)
    return e


def _openai_base(base):
    return base + "/v1" if urlparse(base).path in ("", "/") else base


def _anthropic_url(base, tail):
    return base + tail if not base.endswith("/v1") else base + tail[len("/v1"):]


# --------------------------------------------------------------------------- token usage
def _num(v):
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def _usage_ollama(j):
    # NB: Ollama counts only the prompt tokens it had to evaluate again; a prefix that is still in its cache
    # (the same system prompt as the previous call) is not counted.  "out" includes thinking tokens.
    return {"in": _num(j.get("prompt_eval_count")), "out": _num(j.get("eval_count"))}


def _usage_openai(j):
    u = j.get("usage") or {}
    out = {"in": _num(u.get("prompt_tokens")), "out": _num(u.get("completion_tokens"))}
    cached = _num((u.get("prompt_tokens_details") or {}).get("cached_tokens"))
    reasoning = _num((u.get("completion_tokens_details") or {}).get("reasoning_tokens"))
    if cached:
        out["cache_read"] = cached
    if reasoning:
        out["reasoning"] = reasoning                       # already included in "out"
    return out


def _usage_deepseek(j):
    out = _usage_openai(j)
    hit = _num((j.get("usage") or {}).get("prompt_cache_hit_tokens"))      # DeepSeek reports its cache this way
    if hit:
        out["cache_read"] = hit
    return out


def _usage_anthropic(j):
    u = j.get("usage") or {}
    out = {"in": _num(u.get("input_tokens")), "out": _num(u.get("output_tokens"))}
    for src, dst in (("cache_read_input_tokens", "cache_read"), ("cache_creation_input_tokens", "cache_write")):
        if _num(u.get(src)):
            out[dst] = u[src]
    return out


# --------------------------------------------------------------------------- chat
_no_think = set()          # Ollama models that reject the "think" option (learned from the first error)


def _chat_ollama(p, messages, temperature, schema, effort, timeout):
    body = {"model": p["model"], "messages": messages, "stream": False, "keep_alive": "30m",
            "options": {"temperature": temperature}}
    if effort in ("low", "medium", "high") and p["model"] not in _no_think:
        body["think"] = effort
    if schema:
        body["format"] = schema
    try:
        j = _http("POST", p["base"] + "/api/chat", None, body, timeout)
    except LlmError as e:
        if e.status == 400 and "think" in body and "think" in e.msg.lower():
            _no_think.add(p["model"])
            del body["think"]
            j = _http("POST", p["base"] + "/api/chat", None, body, timeout)
        else:
            raise
    return (j.get("message") or {}).get("content") or "", _usage_ollama(j)


def _drop_rejected(body, err, optional):
    """Some services reject optional parameters (temperature on reasoning models, response_format, ...).
    Remove the one the error message names.  Returns True if something was removed."""
    low = err.msg.lower()
    for k in optional:
        if k in body and (k in low or (k == "response_format" and "json" in low)):
            del body[k]
            return True
    return False


def _chat_openai(p, messages, temperature, schema, effort, timeout):
    headers = {"Authorization": "Bearer " + p["api_key"]} if p.get("api_key") else {}
    body = {"model": p["model"], "messages": messages, "temperature": temperature}
    if schema:
        body["response_format"] = {"type": "json_object"}
    if effort in ("low", "medium", "high"):
        body["reasoning_effort"] = effort
    url = _openai_base(p["base"]) + "/chat/completions"
    for _ in range(4):
        try:
            j = _http("POST", url, headers, body, timeout)
            break
        except LlmError as e:
            if e.status in (400, 422) and _drop_rejected(body, e, ("response_format", "reasoning_effort", "temperature")):
                continue
            raise
    msg = ((j.get("choices") or [{}])[0].get("message")) or {}
    c = msg.get("content")
    if isinstance(c, list):
        c = "".join(x.get("text", "") for x in c if isinstance(x, dict))
    return c or "", _usage_openai(j)


def _chat_deepseek(p, messages, temperature, schema, effort, timeout):
    """DeepSeek: thinking is switched explicitly (it is on by default there); JSON output = response_format json_object
    (the prompts already say "JSON" and give an example, as DeepSeek requires).  DeepSeek may return empty content
    in JSON mode now and then: one retry."""
    headers = {"Authorization": "Bearer " + p.get("api_key", "")}
    body = {"model": p["model"], "messages": messages, "max_tokens": 4096}
    if effort in ("low", "medium", "high"):
        body["thinking"] = {"type": "enabled"}
        body["reasoning_effort"] = effort
    else:
        body["thinking"] = {"type": "disabled"}
        body["temperature"] = temperature                    # ignored by DeepSeek in thinking mode, so only sent without it
    if schema:
        body["response_format"] = {"type": "json_object"}
    url = p["base"].rstrip("/") + "/chat/completions"
    usage, empty = {}, 0
    for _ in range(5):
        try:
            j = _http("POST", url, headers, body, timeout)
        except LlmError as e:
            if e.status in (400, 422) and _drop_rejected(body, e, ("response_format", "reasoning_effort", "thinking", "temperature")):
                continue
            raise
        u = _usage_deepseek(j)
        for k, v in u.items():                               # count the tokens of a retried call too
            if isinstance(v, int):
                usage[k] = usage.get(k, 0) + v
        c = (((j.get("choices") or [{}])[0].get("message")) or {}).get("content") or ""
        if c.strip() or not schema or empty:
            return c, usage
        empty += 1
    return "", usage


def _chat_anthropic(p, messages, temperature, schema, effort, timeout):
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    turns = []
    for m in messages:
        if m["role"] not in ("user", "assistant"):
            continue
        if turns and turns[-1]["role"] == m["role"]:
            turns[-1]["content"] += "\n\n" + m["content"]
        else:
            turns.append({"role": m["role"], "content": m["content"]})
    if not turns or turns[0]["role"] != "user":
        turns.insert(0, {"role": "user", "content": "(Start.)"})
    body = {"model": p["model"], "max_tokens": 4096, "messages": turns, "temperature": temperature}
    if system:
        body["system"] = system
    headers = {"x-api-key": p.get("api_key", ""), "anthropic-version": "2023-06-01"}
    url = _anthropic_url(p["base"], "/v1/messages")
    for _ in range(3):
        try:
            j = _http("POST", url, headers, body, timeout)
            break
        except LlmError as e:
            if e.status in (400, 422) and _drop_rejected(body, e, ("temperature",)):
                continue
            raise
    text = "".join(b.get("text", "") for b in (j.get("content") or []) if isinstance(b, dict) and b.get("type") == "text")
    return text, _usage_anthropic(j)


def _check_ready(name, p):
    if not p["model"]:
        raise LlmError("config", T("need_model"))
    if name != "ollama" and not p.get("api_key") and not (name == "openai" and _is_local(p["base"])):
        raise LlmError("config", T("need_key"))


def _is_local(base):
    host = (urlparse(base).hostname or "").lower()
    return host in ("localhost", "127.0.0.1", "::1") or host.endswith(".local")


def chat(path, messages, temperature=0.2, schema=None, effort=None, timeout=180):
    return chat_with_usage(path, messages, temperature, schema, effort, timeout)[0]


def chat_with_usage(path, messages, temperature=0.2, schema=None, effort=None, timeout=180):
    """Returns (text, usage).  usage = {"in": prompt tokens, "out": completion tokens, ...} as reported by the service."""
    if not isinstance(messages, list) or not messages:
        raise LlmError("config", "messages required")
    msgs = []
    for m in messages:
        if not isinstance(m, dict) or m.get("role") not in ("system", "user", "assistant") or not isinstance(m.get("content"), str):
            raise LlmError("config", "bad message")
        msgs.append({"role": m["role"], "content": m["content"]})
    name, p = active_profile(path)
    _check_ready(name, p)
    if effort not in EFFORTS:
        effort = p.get("think", "off")
    timeout = max(10, min(int(timeout or 180), 600))
    temperature = max(0.0, min(float(temperature), 1.0))
    fn = {"ollama": _chat_ollama, "openai": _chat_openai, "anthropic": _chat_anthropic, "deepseek": _chat_deepseek}[name]
    try:
        text, usage = fn(p, msgs, temperature, schema if isinstance(schema, dict) else None, effort, timeout)
    except LlmError as e:
        raise _friendly(e, name)
    return text, usage


# --------------------------------------------------------------------------- connection test
def test(path):
    """Free of charge: lists the models the service offers.  Returns {ok, short, note, models}."""
    name, p = active_profile(path)
    label = labels()[name]
    # code: machine-readable reason when ok is False ("no_key", "no_model", or the error kind)
    out = {"ok": False, "provider": name, "label": label, "model": p["model"], "models": [], "short": "", "note": "", "code": ""}
    try:
        if name == "ollama":
            j = _http("GET", p["base"] + "/api/tags", None, None, 6)
            out["models"] = [m.get("name", "") for m in j.get("models", []) if isinstance(m, dict)]
        else:
            if not p.get("api_key") and not _is_local(p["base"]):
                out.update(short=T("s_no_key"), note=T("n_no_key"), code="no_key")
                return out
            if name in OPENAI_STYLE:
                headers = {"Authorization": "Bearer " + p["api_key"]} if p.get("api_key") else {}
                try:
                    j = _http("GET", _openai_base(p["base"]) + "/models", headers, None, 12)
                    out["models"] = sorted(str(m.get("id", "")) for m in j.get("data", []) if isinstance(m, dict))
                except LlmError as e:
                    if e.kind == "notfound" or e.status in (405, 501):      # this service has no model list
                        out["ok"] = True
                        out["note"] = T("n_no_list")
                        if not p["model"]:
                            out.update(ok=False, short=T("s_no_model"), note=T("n_no_model"), code="no_model")
                        return out
                    raise
            else:
                headers = {"x-api-key": p["api_key"], "anthropic-version": "2023-06-01"}
                j = _http("GET", _anthropic_url(p["base"], "/v1/models?limit=100"), headers, None, 12)
                out["models"] = [str(m.get("id", "")) for m in j.get("data", []) if isinstance(m, dict)]
    except LlmError as e:
        _friendly(e, name)
        out.update(short=T({"auth": "s_auth", "network": "s_network", "timeout": "s_timeout"}.get(e.kind, "s_error")), note=e.msg, code=e.kind)
        return out
    models = out["models"]
    if not p["model"]:
        out.update(short=T("s_no_model"), code="no_model",
                   note=T("n_pick") + (T("n_models") + T("list_sep").join(models[:15]) + ("…" if len(models) > 15 else "") if models else ""))
        return out
    out["ok"] = True
    found = p["model"] in models or (name == "ollama" and p["model"] + ":latest" in models)
    if models and not found:
        out["note"] = (T("n_ol_miss") % (p["model"], T("list_sep").join(models))) if name == "ollama" \
            else T("n_miss") % p["model"]
    elif name == "ollama" and not models:
        out["note"] = T("n_ol_empty")
    return out
