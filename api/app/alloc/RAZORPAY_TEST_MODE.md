# Razorpay Test Mode checkout

Set these API environment variables from Razorpay Dashboard Test Mode:

```text
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
```

Keep `RAZORPAY_KEY_SECRET` on the API server only. The allocation API returns only
the public key id needed by Razorpay Checkout.

## Checkout flow

1. Call `POST /api/offers/{offer_id}/redeem` with the client-generated `order_id`.
2. Call `POST /api/offers/{offer_id}/checkout` to create a Razorpay order for the
   redeemed offer. Pass its `key_id`, `provider_order_id`, `amount_paise`, and
   `currency` into Razorpay Checkout.
3. On Razorpay success, call `POST /api/offers/{offer_id}/pay` with the original
   Fair Drop `order_id` and:

```json
{
  "order_id": "the Fair Drop order_id used during redeem",
  "provider": "razorpay",
  "razorpay_order_id": "order_...",
  "razorpay_payment_id": "pay_...",
  "razorpay_signature": "..."
}
```

The API verifies the Checkout signature and fetches both provider objects before
setting the offer to `confirmed`. The existing `{ "result": "success" | "fail" }`
request remains available only as the local demo payment flow.

## Frontend Test Mode Without Postgres

To open the hosted Razorpay Test Mode screen without starting the Fair Drop API
or database, run the loopback-only test adapter in one PowerShell terminal:

```powershell
$env:RAZORPAY_KEY_ID = (Select-String '^RAZORPAY_KEY_ID=' .env).Line -replace '^RAZORPAY_KEY_ID=', ''
$env:RAZORPAY_KEY_SECRET = (Select-String '^RAZORPAY_KEY_SECRET=' .env).Line -replace '^RAZORPAY_KEY_SECRET=', ''
$env:PYTHONPATH = "$(Join-Path $PWD 'api');$(Join-Path $PWD 'common')"
.\.venv\Scripts\python.exe -m uvicorn razorpay_test_server:app --app-dir api --host 127.0.0.1 --port 8001
```

Open `http://localhost:5173/#/?paymentTest=1`, choose any of the three preview
layers, and select **Continue to test payment**. The preview does not reserve a
ticket. Pay opens a fixed ₹1 Test Mode order; successful checkout callbacks are
verified by the adapter using the same Member 3 payment module. The adapter
accepts loopback requests only and stores no payment credentials or order state
in the repository. Never use real-mode credentials with this endpoint.
