from pathlib import Path

import yaml


def test_compose_web_preserves_contract_import_layout():
    root = Path(__file__).resolve().parents[2]
    web = yaml.safe_load((root / "docker-compose.yml").read_text(encoding="utf-8"))["services"]["web"]
    directory = web["working_dir"]
    mounts = web["volumes"]
    assert f"./frontend:{directory}" in mounts
    assert f"./contracts:{Path(directory).parent.as_posix()}/contracts:ro" in mounts
    assert f"web_node_modules:{directory}/node_modules" in mounts
