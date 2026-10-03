"""Resolve other members' modules, falling back to throwaway stubs until they land.

Per the plan, the consumer writes the stub. Member 2 consumes:
  canonical  (Member 4)  config_bytes, exclusions_bytes, snapshot_bytes, receipt_bytes
  sybil      (Member 4)  apply
  drand      (Member 3)  round_at, time_of, CHAIN

When the real module exists in fairdrop_common it is used automatically and the
stub under _stubs/ can be deleted. Only a *missing* module falls back; an error
inside a real module is raised, never masked.
"""
import importlib


def _load(name: str):
    try:
        return importlib.import_module(f"fairdrop_common.{name}")
    except ModuleNotFoundError as e:
        if e.name != f"fairdrop_common.{name}":
            raise
        return importlib.import_module(f"fairdrop_common._stubs.{name}")


canonical = _load("canonical")
sybil = _load("sybil")
drand = _load("drand")


def using_stubs() -> dict[str, bool]:
    return {m.__name__.rsplit(".", 1)[-1]: "._stubs." in m.__name__ for m in (canonical, sybil, drand)}
