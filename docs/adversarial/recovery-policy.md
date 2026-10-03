# M1 recovery scope — 2026-10-04

Entry acceptance survives receipt/proof storage failures in memory for the current
page lifetime. Reload recovery still requires working browser storage or a server
receipt endpoint; the UI does not claim persistence when storage fails.

For `payment_pending` without `fd.order.<offer_id>`, M1 keeps:
“Finish paying on the device where you pressed Buy.”

The supported server repair is for M3 to add the persisted `order_id` to the
authenticated `/me` response's `offer`, document it in OpenAPI, and test recovery
after redeem succeeds but the client loses its local order ID. M1 does not create
a replacement order, re-redeem with another ID or infer an ID from payment data.

F09's M1 behavior is fixed within this scope. Cross-device payment recovery remains
dependent on that M3 contract change.
