"""Tiempo de vida de las ofertas durante la negociación.

Solo las **ofertas** de los conductores caducan: cada una vive ``OFFER_TTL``
(30 s) desde que se crea (``Offer.created_at``). Al vencer, el pasajero ya no la
ve ni puede aceptarla.

La **solicitud** del pasajero no caduca por tiempo: busca indefinidamente hasta
que el pasajero la cancela manualmente.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.domain.entities import ACTIVE_OFFER_STATUSES, Offer

OFFER_TTL = timedelta(seconds=30)


def _as_utc(moment: datetime) -> datetime:
    # ``DateTime(timezone=True)`` puede llegar sin tz desde SQLite; lo asumimos UTC.
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment


def offer_expires_at(offer: Offer) -> datetime | None:
    """Deadline de la oferta: ``created_at + OFFER_TTL`` (30 s desde su creación)."""
    if offer.created_at is None:
        return None
    return _as_utc(offer.created_at) + OFFER_TTL


def is_offer_expired(offer: Offer, now: datetime | None = None) -> bool:
    deadline = offer_expires_at(offer)
    if deadline is None:
        return False
    return (now or datetime.now(UTC)) >= deadline


def is_offer_active(offer: Offer, now: datetime | None = None) -> bool:
    """Una oferta sigue en juego: ``PENDING`` y sin vencer."""
    return offer.status in ACTIVE_OFFER_STATUSES and not is_offer_expired(offer, now)
