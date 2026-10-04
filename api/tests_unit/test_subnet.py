from types import SimpleNamespace

from app.entry import ratelimit


def test_subnet_of():
    assert ratelimit.subnet_of("203.0.113.77") == "203.0.113.0/24"
    assert ratelimit.subnet_of("2001:db8:1:2::9") == "2001:db8:1::/48"
    assert ratelimit.subnet_of("::ffff:198.51.100.9") == "198.51.100.0/24"
    assert ratelimit.subnet_of("testclient") is None


def test_trusted_accepts_cidr_and_exact(monkeypatch):
    monkeypatch.setattr(ratelimit, "get_settings", lambda: SimpleNamespace(trusted_proxies=["testclient", "10.0.0.0/8"]))
    assert ratelimit._trusted("testclient") and ratelimit._trusted("10.9.8.7")
    assert not ratelimit._trusted("11.0.0.1") and not ratelimit._trusted("garbage")
