"""Shared enums. Copied from the build plan; FROZEN like everything in contracts/.

Status is always derived by the server and never computed by a client.
Owner: Member 2.
"""
from enum import Enum


class _StrEnum(str, Enum):
    def __str__(self) -> str:
        return self.value


class Phase(_StrEnum):
    scheduled = "scheduled"
    open = "open"
    sealed = "sealed"
    drawn = "drawn"
    settled = "settled"


class OfferStatus(_StrEnum):
    offered = "offered"
    payment_pending = "payment_pending"
    confirmed = "confirmed"
    expired = "expired"
    declined = "declined"
    payment_failed = "payment_failed"


class EntryStatus(_StrEnum):
    """Returned by GET /me."""
    registered = "registered"
    excluded = "excluded"
    waitlisted = "waitlisted"
    offered = "offered"
    payment_pending = "payment_pending"
    confirmed = "confirmed"
    expired = "expired"
    declined = "declined"
    payment_failed = "payment_failed"
    not_selected = "not_selected"


class ExclusionReason(_StrEnum):
    pow_invalid = "pow_invalid"
    pow_missing = "pow_missing"
    # Sybil exclusions are "sybil:<rule_id>"; build them with sybil_reason().


def sybil_reason(rule_id: str) -> str:
    return f"sybil:{rule_id}"


class ErrorCode(_StrEnum):
    window_closed = "window_closed"
    entry_exists_different_terms = "entry_exists_different_terms"
    unknown_tier = "unknown_tier"
    quantity_exceeds_max = "quantity_exceeds_max"
    turnstile_failed = "turnstile_failed"
    offer_expired = "offer_expired"
    offer_not_yours = "offer_not_yours"
    already_redeemed_other_order = "already_redeemed_other_order"
    not_offered = "not_offered"
    payment_window_closed = "payment_window_closed"
    not_payment_pending = "not_payment_pending"


class TransportError(_StrEnum):
    """Generic HTTP-level errors that are not part of the domain ErrorCode list."""
    unauthorized = "unauthorized"          # 401: missing/invalid identity JWT or admin key
    invalid_request = "invalid_request"    # 422: body does not match the schema
    not_found = "not_found"                # 404
    rate_limited = "rate_limited"          # 429
    conflict = "conflict"                  # 409 for admin operations in the wrong phase


class AllocationMode(_StrEnum):
    lottery_wil = "lottery_wil"
    fcfs = "fcfs"


class SybilRuleKind(_StrEnum):
    """The fixed set of rule kinds. POST /admin/drops rejects anything else."""
    max_per_device = "max_per_device"
    max_per_payment = "max_per_payment"
    min_account_age_s = "min_account_age_s"
