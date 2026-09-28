"""Phone version in a headless Chromium with an iPhone-sized screen and touch, the fake model from the desktop tests.

    python tests/test_mobile.py        (needs: pip install playwright; the desktop version's tests/ folder for fake_llm.py)
"""
import functools
import http.server
import json
import os
import sys
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DESKTOP = os.environ.get("SW_DESKTOP", os.path.join(ROOT, "..", "schreibwerkstatt"))
sys.path.insert(0, os.path.join(DESKTOP, "tests"))
from fake_llm import FakeModel                       # noqa: E402
from playwright.sync_api import sync_playwright      # noqa: E402

IPHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
              user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")


class Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript",
                      ".wasm": "application/wasm", ".webmanifest": "application/manifest+json"}

    def log_message(self, *a):
        pass


class Mobile(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d/docs/" % cls.httpd.server_address[1]    # like GitHub Pages: a sub-folder
        cls.fake = FakeModel().start()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()
        cls.ctx = cls.browser.new_context(**IPHONE, service_workers="block")
        cls.ctx.route(cls.fake.url.rsplit("/v1", 1)[0] + "/**", cls._cors)

    @classmethod
    def _cors(cls, route):
        """The fake model is another origin: answer like a real API that allows browsers (CORS)."""
        acao = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"}
        if route.request.method == "OPTIONS":
            route.fulfill(status=204, headers=acao)
            return
        r = route.fetch()
        route.fulfill(response=r, headers={**r.headers, **acao})

    @classmethod
    def tearDownClass(cls):
        cls.ctx.close(); cls.browser.close(); cls.pw.stop(); cls.fake.stop(); cls.httpd.shutdown()

    def open(self):
        pg = self.ctx.new_page()
        self.errors = []
        pg.on("pageerror", lambda e: self.errors.append("page error: %s" % e))
        pg.on("console", lambda m: self.errors.append("console: %s" % m.text) if m.type == "error" else None)
        t = time.time()
        pg.goto(self.base)
        pg.wait_for_selector(".m-splash", state="detached", timeout=60000)
        pg.wait_for_function("() => window.__sw", timeout=20000)
        self.boot_s = time.time() - t
        return pg

    @staticmethod
    def api(pg, method, path, body=None):
        return pg.evaluate("""async ([m, p, b]) => { const r = await fetch('/api' + p, {method: m, headers: {'Content-Type': 'application/json'},
            body: b ? JSON.stringify(b) : undefined}); return [r.status, await r.json()]; }""", [method, path, body])

    def test_1_everything(self):
        pg = self.open()
        print("\n  start-up: %.1f s" % self.boot_s)
        # first start: choose the app language, what to learn, the level
        pg.wait_for_selector(".m-onb", timeout=10000)
        pg.screenshot(path=os.path.join(HERE, "shot-onboard.png"))
        pg.tap(".m-onb-opt[data-v=zh]")
        self.assertIn("你想学", pg.inner_text(".m-onb h2"))
        pg.tap(".m-onb-opt[data-v=de]")
        pg.tap(".m-onb-opt[data-v=B1]")
        pg.wait_for_selector(".m-onb", state="detached")
        pg.wait_for_function("() => document.getElementById('selLevel').value === 'B1'", timeout=5000)
        pg.evaluate("() => new Promise(r => setTimeout(r, 500))")
        st, h = self.api(pg, "GET", "/health")
        self.assertEqual(st, 200); self.assertTrue(h["mobile"]); self.assertEqual(h["version"], "0.7")
        st, s = self.api(pg, "GET", "/settings")
        self.assertEqual(s["active"], "anthropic")                                  # phone default: no Ollama
        self.assertEqual(pg.locator("#cfgProvider option[value=ollama]").count(), 0)
        self.assertEqual(pg.get_attribute("#input", "enterkeyhint"), "send")
        st, s = self.api(pg, "GET", "/settings")
        self.assertEqual((s["explain_lang"], s["learn_lang"], s["level"]), ("zh", "de", "B1"))
        self.api(pg, "PUT", "/settings", {"active": "openai", "learn_lang": "de", "explain_lang": "zh", "level": "B1",
                                          "profile": {"provider": "openai", "base": self.fake.url, "model": "fake-model", "api_key": "x"}})
        st, s = self.api(pg, "GET", "/settings")
        self.assertTrue(s["profiles"]["openai"]["has_key"]); self.assertNotIn("api_key", json.dumps(s))
        pg.close()

        # settings survive a restart (IndexedDB); the connection test goes through the fetch "replay"
        pg = self.open()
        pg.wait_for_function("() => __sw.conn.mode === 'online'", timeout=20000)
        pg.screenshot(path=os.path.join(HERE, "shot-start.png"))
        # one exercise: tap the button, translate, correction card
        self.assertTrue(pg.is_hidden("#topic")); self.assertTrue(pg.is_hidden("#selLearn"))     # behind the ☰ menu
        self.assertIn("DE·ZH B1", pg.inner_text("#mMenuBtn"))
        pg.tap("#mMenuBtn")
        self.assertTrue(pg.is_visible("#topic")); self.assertTrue(pg.is_visible("#selLevel"))
        pg.locator(".m-fz .btn").nth(1).tap()                                         # text size: smaller
        self.assertEqual(pg.evaluate("() => getComputedStyle(document.querySelector('#streamIn')).zoom"), "0.9")
        pg.screenshot(path=os.path.join(HERE, "shot-menu.png"))
        pg.tap("#btnPrompt")
        self.assertTrue(pg.is_hidden("#mMenu"))
        pg.wait_for_function("() => !__sw.state.busy && __sw.state.pending", timeout=30000)
        self.assertTrue(pg.is_visible(".bubble.prompt [data-act=giveup]")); self.assertTrue(pg.is_hidden("#pendingBar"))
        pg.screenshot(path=os.path.join(HERE, "shot-pending.png"))
        pg.fill("#input", "Ich will diese Wohenende eine Ausstellung im München sehen")
        pg.tap("#btnSend")
        pg.wait_for_function("() => !__sw.state.busy", timeout=30000)
        m = pg.evaluate("() => __sw.state.session.messages.filter(m => m.role === 'user').pop()")
        self.assertEqual(m["kind"], "translate")
        self.assertEqual(m["corrected"], "Ich will dieses Wochenende eine Ausstellung in München sehen")
        self.assertGreater(pg.locator(".fb mark.del").count(), 0)
        pg.wait_for_function("() => __sw.state.session.messages.every(m => m.dbId)", timeout=10000)
        pg.screenshot(path=os.path.join(HERE, "shot-feedback.png"))
        # nothing sticks out sideways on a 390 px screen
        self.assertLessEqual(pg.evaluate("() => document.documentElement.scrollWidth"), 390)
        # keyboard open (the visible height shrinks): toolbars hide, the conversation keeps the space
        pg.focus("#input")
        pg.set_viewport_size({"width": 390, "height": 420})
        pg.wait_for_function("() => document.documentElement.classList.contains('kb')", timeout=5000)
        self.assertTrue(pg.is_hidden(".toolbar")); self.assertTrue(pg.is_hidden(".langbar"))
        self.assertTrue(pg.is_visible("#btnSend")); self.assertTrue(pg.is_visible(".tabs"))
        self.assertGreater(pg.evaluate("() => document.getElementById('stream').clientHeight"), 150)
        pg.screenshot(path=os.path.join(HERE, "shot-keyboard.png"))
        pg.set_viewport_size({"width": 390, "height": 844})
        pg.wait_for_function("() => !document.documentElement.classList.contains('kb')", timeout=5000)
        self.assertTrue(pg.is_visible("#mMenuBtn"))
        # retype (跟着敲) by tapping
        pg.locator(".fb-actions button", has_text="跟着敲").last.tap()
        target = pg.inner_text(".rt-target")
        pg.type(".rt-input", target)
        pg.keyboard.press("Enter")
        self.assertIn("✓", pg.inner_text(".rt-msg"))
        # a question
        pg.fill("#input", '"押金"用德语怎么说？')
        pg.tap("#btnSend")
        pg.wait_for_function("() => !__sw.state.busy", timeout=30000)
        self.assertIn("Kaution", pg.locator(".bubble.ai").last.inner_text())
        pg.evaluate("() => new Promise(r => setTimeout(r, 300))")
        pg.close()

        # history, review list and statistics after a restart
        pg = self.open()
        st, rows = self.api(pg, "GET", "/sessions?lang=de")
        self.assertEqual(len(rows), 1); self.assertEqual(rows[0]["counts"]["translate"], 1); self.assertEqual(rows[0]["counts"]["ask"], 1)
        st, rv = self.api(pg, "GET", "/reviews?lang=de&explain=zh")
        self.assertEqual(rv["counts"]["waiting"], 1)                               # the wrong translation comes back tomorrow
        pg.tap(".tab[data-view=history]")
        pg.wait_for_selector("#histCards .card")
        pg.screenshot(path=os.path.join(HERE, "shot-history.png"))
        pg.tap("#btnStats")
        pg.wait_for_selector("#heat .day")
        pg.screenshot(path=os.path.join(HERE, "shot-stats.png"))
        self.assertLessEqual(pg.evaluate("() => document.documentElement.scrollWidth"), 390)
        pg.tap("#status")
        pg.wait_for_selector("#mBackup")
        pg.screenshot(path=os.path.join(HERE, "shot-settings.png"))

        # backup: export, then import it again
        exp = pg.evaluate("async () => { const r = await __mobile.call({type: 'export'}); return [r.ok, r.bytes.length, new TextDecoder().decode(r.bytes.slice(0, 15))]; }")
        self.assertEqual(exp[0], True); self.assertEqual(exp[2], "SQLite format 3")
        imp = pg.evaluate("""async () => { const e = await __mobile.call({type: 'export'});
            return await __mobile.call({type: 'import', bytes: e.bytes.buffer}, [e.bytes.buffer]); }""")
        self.assertTrue(imp["ok"], imp); self.assertEqual(imp["sessions"], 1)
        bad = pg.evaluate("() => __mobile.call({type: 'import', bytes: new TextEncoder().encode('hello').buffer})")
        self.assertFalse(bad["ok"])
        pg.close()
        self.assertEqual(self.errors, [])

    def test_2_model_error_is_friendly(self):
        """A wrong API key: the service's 401 comes back as the desktop's message, not a crash."""
        pg = self.open()
        self.ctx.route("https://api.anthropic.com/**", lambda r: r.fulfill(status=401, headers={"access-control-allow-origin": "*"},
                       body='{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'))
        self.api(pg, "PUT", "/settings", {"active": "anthropic", "profile": {"provider": "anthropic", "model": "claude-x", "api_key": "bad"}})
        st, r = self.api(pg, "POST", "/llm/chat", {"messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(st, 502); self.assertEqual(r["kind"], "auth"); self.assertIn("invalid x-api-key", r["error"])
        seen = []
        self.ctx.unroute("https://api.anthropic.com/**")
        def ok(route):
            seen.append(route.request.headers)
            route.fulfill(status=200, headers={"access-control-allow-origin": "*", "content-type": "application/json"},
                          body=json.dumps({"content": [{"type": "text", "text": "Hallo!"}], "usage": {"input_tokens": 5, "output_tokens": 2}}))
        self.ctx.route("https://api.anthropic.com/**", ok)
        st, r = self.api(pg, "POST", "/llm/chat", {"messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual((st, r["content"]), (200, "Hallo!"))
        self.assertEqual(seen[-1].get("anthropic-dangerous-direct-browser-access"), "true")
        self.api(pg, "PUT", "/settings", {"active": "openai"})
        self.ctx.unroute("https://api.anthropic.com/**")
        pg.close()

    def test_3_offline_after_first_start(self):
        """Service worker: after the first start every file is on the phone; the app starts again without network."""
        ctx = self.browser.new_context(**IPHONE)
        pg = ctx.new_page()
        pg.goto(self.base)
        pg.wait_for_selector(".m-splash", state="detached", timeout=60000)
        pg.wait_for_function("async () => { const r = await navigator.serviceWorker.ready; return !!r.active; }", timeout=60000)
        pg.wait_for_function("async () => (await caches.keys()).length === 1 && (await (await caches.open((await caches.keys())[0])).keys()).length > 40", timeout=60000)
        self.api(pg, "POST", "/sessions", {"lang": "de"})
        ctx.set_offline(True)
        pg.reload()
        pg.wait_for_selector(".m-splash", state="detached", timeout=60000)
        st, h = self.api(pg, "GET", "/health")
        self.assertEqual(st, 200)
        self.assertTrue(pg.evaluate("() => !!navigator.serviceWorker.controller"))
        ctx.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
