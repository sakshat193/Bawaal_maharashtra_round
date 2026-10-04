from fastapi.testclient import TestClient

from app import main


def test_health_is_liveness_without_database(monkeypatch):
    def unavailable():
        raise AssertionError("liveness must not touch the database")

    monkeypatch.setattr(main, "get_pool", unavailable)
    app = main.create_app()
    # No lifespan: exercise the route with an unavailable database.
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert "/health" not in app.openapi()["paths"]
