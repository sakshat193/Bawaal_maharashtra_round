# Fair Drop common helpers

## drand verification boundary

`drand.fetch(round_number)` waits for the requested Quicknet round at both
`api.drand.sh` and `drand.cloudflare.com`. It requires the relays to return the
same signature and checks that `randomness == SHA-256(signature)`.

This is two-relay agreement plus a hash consistency check. It does not perform
BLS signature verification; callers should represent that boundary accurately in
the product and verification UI.
