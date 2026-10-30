"""Hermetic boundary regression: not a real WireGuard, Cloudflare or kernel firewall test."""
import hmac
import unittest

class Webhook:
    def __init__(self, secret):
        self.secret = secret
    def accept(self, path, method, headers):
        token = headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        return (path == "/telegram/webhook" and method == "POST"
                and isinstance(token, str)
                and hmac.compare_digest(token.encode(), self.secret.encode()))

class Proxy:
    def __init__(self):
        self.up = True
        self.calls = []
    def send(self, host, body):
        if not self.up:
            raise ConnectionError("proxy unreachable")
        self.calls.append((host, body))
        return b"ok"

class Egress:
    def __init__(self, proxy):
        self.proxy = proxy
    def send(self, host, body):
        if host != "api.telegram.org":
            raise PermissionError("host not allowed")
        if self.proxy is None or not self.proxy.up:
            raise ConnectionError("fail closed")
        return self.proxy.send(host, body)

class BoundaryTest(unittest.TestCase):
    def setUp(self):
        self.web = Webhook("only-fixture-secret")
        self.p = Proxy()
        self.e = Egress(self.p)
    def test_valid(self):
        self.assertTrue(self.web.accept("/telegram/webhook","POST",{"X-Telegram-Bot-Api-Secret-Token":"only-fixture-secret"}))
    def test_missing_token(self):
        self.assertFalse(self.web.accept("/telegram/webhook","POST",{}))
    def test_wrong_token(self):
        self.assertFalse(self.web.accept("/telegram/webhook","POST",{"X-Telegram-Bot-Api-Secret-Token":"wrong"}))
    def test_wrong_method(self):
        self.assertFalse(self.web.accept("/telegram/webhook","GET",{"X-Telegram-Bot-Api-Secret-Token":"only-fixture-secret"}))
    def test_proxy_delivery(self):
        self.assertEqual(self.e.send("api.telegram.org",b"sample"),b"ok")
        self.assertEqual(self.p.calls,[("api.telegram.org",b"sample")])
    def test_proxy_down(self):
        self.p.up=False
        with self.assertRaises(ConnectionError):
            self.e.send("api.telegram.org",b"sample")
        self.assertEqual(self.p.calls,[])
    def test_no_proxy(self):
        self.e.proxy=None
        with self.assertRaises(ConnectionError):
            self.e.send("api.telegram.org",b"sample")
    def test_other_destination(self):
        with self.assertRaises(PermissionError):
            self.e.send("example.com",b"sample")
        self.assertEqual(self.p.calls,[])

if __name__ == "__main__":
    unittest.main()
