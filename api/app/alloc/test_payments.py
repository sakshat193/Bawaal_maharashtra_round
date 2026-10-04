import asyncio
import hashlib
import importlib.util
import hmac
import os
import unittest
from pathlib import Path
from unittest.mock import patch

_SPEC = importlib.util.spec_from_file_location("member3_payments", Path(__file__).with_name("payments.py"))
payments = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(payments)


class RazorpayAdapterTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {"RAZORPAY_KEY_ID": "rzp_test_example", "RAZORPAY_KEY_SECRET": "test-secret"},
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_create_order_uses_paise_inr_and_an_offer_bound_receipt(self):
        with patch.object(payments, "_request", return_value={"id": "order_123"}) as request:
            result = asyncio.run(payments.create_order(
                offer_id="00000000-0000-0000-0000-000000000001", amount_paise=900_000,
            ))

        self.assertEqual(result, {
            "key_id": "rzp_test_example", "provider_order_id": "order_123",
            "amount_paise": 900_000, "currency": "INR",
        })
        request.assert_called_once_with(
            "POST", "/orders",
            {"amount": 900_000, "currency": "INR", "receipt": "fd_00000000000000000000000000000001"},
        )

    def test_verify_payment_requires_signature_and_matching_provider_records(self):
        offer_id, provider_order_id, payment_id = "00000000-0000-0000-0000-000000000001", "order_123", "pay_123"
        signature = hmac.new(b"test-secret", f"{provider_order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
        order = {"receipt": "fd_00000000000000000000000000000001", "amount": 900_000, "currency": "INR"}
        payment = {"order_id": provider_order_id, "amount": 900_000, "currency": "INR", "status": "captured"}
        with patch.object(payments, "_request", side_effect=[order, payment]):
            asyncio.run(payments.verify_payment(
                offer_id=offer_id, amount_paise=900_000, provider_order_id=provider_order_id,
                payment_id=payment_id, signature=signature,
            ))

    def test_verify_payment_rejects_a_bad_checkout_signature_before_network_io(self):
        with patch.object(payments, "_request") as request:
            with self.assertRaisesRegex(payments.PaymentProviderError, "signature"):
                asyncio.run(payments.verify_payment(
                    offer_id="00000000-0000-0000-0000-000000000001", amount_paise=900_000,
                    provider_order_id="order_123", payment_id="pay_123", signature="bad",
                ))
        request.assert_not_called()

    def test_verify_payment_rejects_an_uncaptured_payment(self):
        offer_id, provider_order_id, payment_id = "00000000-0000-0000-0000-000000000001", "order_123", "pay_123"
        signature = hmac.new(b"test-secret", f"{provider_order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
        order = {"receipt": "fd_00000000000000000000000000000001", "amount": 900_000, "currency": "INR"}
        payment = {"order_id": provider_order_id, "amount": 900_000, "currency": "INR", "status": "authorized"}
        with patch.object(payments, "_request", side_effect=[order, payment]):
            with self.assertRaisesRegex(payments.PaymentProviderError, "does not match"):
                asyncio.run(payments.verify_payment(
                    offer_id=offer_id, amount_paise=900_000, provider_order_id=provider_order_id,
                    payment_id=payment_id, signature=signature,
                ))

    def test_refund_payment_posts_the_captured_amount_and_requires_a_refund_id(self):
        with patch.object(payments, "_request", return_value={"id": "rfnd_1"}) as request:
            asyncio.run(payments.refund_payment(payment_id="pay_123", amount_paise=900_000))
        request.assert_called_once_with("POST", "/payments/pay_123/refund", {"amount": 900_000})
        with patch.object(payments, "_request", return_value={}):
            with self.assertRaisesRegex(payments.PaymentProviderError, "refund"):
                asyncio.run(payments.refund_payment(payment_id="pay_123", amount_paise=900_000))

