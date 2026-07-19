"""Errores propios de la orquestación de la aplicación."""

from __future__ import annotations


class InvalidRealtimeOutboxBatchError(ValueError):
    """El lote reclamado de la outbox no cumple el contrato de publicación."""

