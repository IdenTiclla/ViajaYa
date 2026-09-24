"""Lifetime of offers during the negotiation.

Only drivers' **offers** expire: each one lives ``OFFER_TTL``
(30 s) from its creation (``Offer.created_at``). Once expired, the passenger no longer
sees it and cannot accept it.

The passenger's **request** does not expire over time: it searches indefinitely until
the passenger cancels it manually.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.domain.entities import ACTIVE_OFFER_STATUSES, Offer

OFFER_TTL = timedelta(seconds=30)


def _as_utc(moment: datetime) -> datetime:
    # ``DateTime(timezone=True)`` may come back without tz from SQLite; we assume UTC.
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment


def offer_expires_at(offer: Offer) -> datetime | None:
    """Offer deadline: ``created_at + OFFER_TTL`` (30 s after creation)."""
    if offer.created_at is None:
        return None
    return _as_utc(offer.created_at) + OFFER_TTL


def is_offer_expired(offer: Offer, now: datetime | None = None) -> bool:
    deadline = offer_expires_at(offer)
    if deadline is None:
        return False
    return (now or datetime.now(UTC)) >= deadline


def is_offer_active(offer: Offer, now: datetime | None = None) -> bool:
    """An offer is still in play: ``PENDING`` and not expired."""
    return offer.status in ACTIVE_OFFER_STATUSES and not is_offer_expired(offer, now)
