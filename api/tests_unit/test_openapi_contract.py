from pathlib import Path

import yaml


def test_allocation_and_payment_contract_matches_existing_routes():
    contract = yaml.safe_load((Path(__file__).resolve().parents[2] / "contracts/openapi.yaml").read_text(encoding="utf-8"))
    assert contract["info"]["version"] == "0.2.0"
    schemas = contract["components"]["schemas"]
    paths = contract["paths"]
    for path, schema in [("/api/drops/{drop_id}/draw", "Draw"), ("/api/drops/{drop_id}/invariants", "Invariants"), ("/api/offers/{offer_id}/checkout", "Checkout")]:
        method = "post" if path.endswith("checkout") else "get"
        assert paths[path][method]["responses"]["200"]["content"]["application/json"]["schema"] == {"$ref": f"#/components/schemas/{schema}"}
    assert set(schemas["Draw"]["required"]) == {"drop_id", "round", "signature", "randomness", "relays", "drawn_at", "ranked_entry_ids", "allocation"}
    assert set(schemas["Invariants"]["required"]) == {"tiers", "oversell", "held_mismatch", "double_redemption"}
    assert set(schemas["Checkout"]["required"]) == {"provider", "key_id", "provider_order_id", "amount_paise", "currency", "pay_deadline"}
    assert "payment_unavailable" in schemas["ErrorCode"]["enum"]
    payment = paths["/api/offers/{offer_id}/pay"]["post"]["requestBody"]["content"]["application/json"]["schema"]
    assert payment["oneOf"] == [{"$ref": "#/components/schemas/MockPayment"}, {"$ref": "#/components/schemas/RazorpayPayment"}]
    assert set(schemas["RazorpayPayment"]["required"]) == {"order_id", "provider", "razorpay_order_id", "razorpay_payment_id", "razorpay_signature"}
