"""Shared realtime (WebSocket) infrastructure.

Keeps connections in the ``uvicorn`` process memory and groups them by
*topic* (logical channel). The offer negotiation (plan 0004) and live
location (plan 0003) reuse this same hub.
"""
