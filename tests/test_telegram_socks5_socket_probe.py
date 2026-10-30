"""Real loopback SOCKS5 security probe; NOT a real VPN/IP anonymity test."""
import socket
import socketserver
import threading
import unittest

class Target(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.sendall(b"ACK:" + self.request.recv(16))

class TCP(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

class Proxy(socketserver.BaseRequestHandler):
    def handle(self):
        s = self.request
        s.settimeout(1)
        def rd(n):
            result = b""
            while len(result) < n:
                part = s.recv(n - len(result))
                if not part:
                    raise OSError("closed")
                result += part
            return result
        try:
            if rd(3) != b"\x05\x01\x00":
                return
            s.sendall(b"\x05\x00")
            if rd(4) != b"\x05\x01\x00\x01":
                return
            host = socket.inet_ntoa(rd(4))
            port = int.from_bytes(rd(2), "big")
            if (host, port) != self.server.allowed:
                s.sendall(b"\x05\x02" + b"\x00" * 8)
                return
            with socket.create_connection((host, port), timeout=1) as target:
                s.sendall(b"\x05\x00" + b"\x00" * 8)
                target.sendall(rd(4))
                s.sendall(target.recv(32))
        except (OSError, TimeoutError):
            pass

def start(handler):
    srv = TCP(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.target = start(Target)
        cls.proxy = start(Proxy)
        cls.proxy.allowed = cls.target.server_address
    @classmethod
    def tearDownClass(cls):
        cls.proxy.shutdown()
        cls.proxy.server_close()
        cls.target.shutdown()
        cls.target.server_close()
    def relay(self, host, port):
        with socket.create_connection(self.proxy.server_address, timeout=1) as s:
            s.settimeout(1)
            s.sendall(b"\x05\x01\x00")
            self.assertEqual(s.recv(2), b"\x05\x00")
            s.sendall(b"\x05\x01\x00\x01" + socket.inet_aton(host) + port.to_bytes(2, "big"))
            reply = s.recv(10)
            if reply[:2] != b"\x05\x00":
                return reply[:2], None
            s.sendall(b"ping")
            return reply[:2], s.recv(32)
    def test_relay(self):
        self.assertEqual(self.relay(*self.target.server_address), (b"\x05\x00", b"ACK:ping"))
    def test_deny_other_host(self):
        self.assertEqual(self.relay("127.0.0.2", self.target.server_address[1]), (b"\x05\x02", None))
    def test_deny_other_port(self):
        self.assertEqual(self.relay("127.0.0.1", self.target.server_address[1]+1), (b"\x05\x02", None))
    def test_stopped_proxy_connection_fails(self):
        temp = socket.socket()
        temp.bind(("127.0.0.1", 0))
        addr = temp.getsockname()
        temp.close()
        with self.assertRaises(OSError):
            socket.create_connection(addr, timeout=.2)
    def test_direct_path_remains_without_firewall(self):
        with socket.create_connection(self.target.server_address, timeout=1) as s:
            s.sendall(b"ping")
            self.assertEqual(s.recv(32), b"ACK:ping")

if __name__ == "__main__":
    unittest.main(verbosity=2)
