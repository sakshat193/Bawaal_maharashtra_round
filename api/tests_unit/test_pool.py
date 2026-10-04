from app import db


def test_pool_checks_connections_before_checkout(monkeypatch):
    options = {}

    class Pool:
        check_connection = object()

        def __init__(self, *args, **kwargs):
            options.update(kwargs)

        def wait(self, timeout):
            assert timeout == 30

    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(db, "ConnectionPool", Pool)
    db.get_pool()
    assert options["check"] is Pool.check_connection
    monkeypatch.setattr(db, "_pool", None)
