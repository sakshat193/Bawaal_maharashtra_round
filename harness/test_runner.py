from pathlib import Path

from harness.profiles import load_users
from harness.runner import _summarize


def test_summary_keeps_profile_classification():
    profiles, users = load_users(Path("harness/profiles.yaml"))
    for index, user in enumerate(users):
        user["identity_id"] = f"identity-{index}"
        user["entry_id"] = f"entry-{index}"
    result = _summarize("lottery_wil", users, [], {}, {})
    for name, spec in profiles.items():
        if spec["count"]:
            assert result["profiles"][name]["bot"] is bool(spec.get("bot", False))
            assert result["profiles"][name]["cohort"] == spec.get("cohort", name)


def test_documented_output_is_served_by_frontend():
    readme = Path("harness/README.md").read_text(encoding="utf-8")
    assert "--out frontend/public/results.json" in readme
    assert "web/public/results.json" not in readme
