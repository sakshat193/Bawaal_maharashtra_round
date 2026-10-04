import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_render_uses_persistent_secret_files_and_liveness():
    service, = yaml.safe_load((ROOT / "render.yaml").read_text())["services"]
    assert {key: service[key] for key in ("name", "runtime", "plan", "region", "branch")} == {
        "name": "fairdrop-api", "runtime": "docker", "plan": "free", "region": "singapore", "branch": "main"}
    assert service["healthCheckPath"] == "/health"
    assert service["dockerfilePath"] == "./api/Dockerfile"
    assert service["dockerContext"] == "."
    # Render runs the image's own CMD (a quoted dockerCommand was exec'd as one program name).
    assert "dockerCommand" not in service
    cmd = next(line for line in (ROOT / "api/Dockerfile").read_text().splitlines() if line.startswith("CMD "))
    assert "python -m app.migrate && exec uvicorn" in cmd
    assert "${PORT:-8000}" in cmd
    assert "--workers" not in cmd
    env = {item["key"]: item for item in service["envVars"]}
    assert env["DATABASE_URL"]["sync"] is False
    assert env["ADMIN_KEY"]["generateValue"] is True
    for key, filename in [("PLATFORM_KEY_FILE", "platform_ed25519.pem"), ("RECEIPT_KEY_FILE", "receipt_ed25519.pem"), ("POW_KEY_FILE", "pow_hmac.key")]:
        assert env[key]["value"] == f"/etc/secrets/{filename}"


def test_proxy_and_keepalive_share_render_host():
    host = "https://fairdrop-api.onrender.com"
    vercel = json.loads((ROOT / "frontend/vercel.json").read_text())
    assert vercel["rewrites"] == [{"source": f"/{prefix}/:path*", "destination": f"{host}/{prefix}/:path*"} for prefix in ("api", "platform")]
    workflow = yaml.safe_load((ROOT / ".github/workflows/keepalive.yml").read_text())
    assert workflow["on"]["schedule"] == [{"cron": "*/10 * * * *"}]
    assert "workflow_dispatch" in workflow["on"]
    job = workflow["jobs"]["ping"]
    assert job["if"] == "github.ref == 'refs/heads/main'"
    assert f"curl -fsS --retry 3 --max-time 90 {host}/health" in job["steps"][0]["run"]
