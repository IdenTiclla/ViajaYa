"""Infraestructura de tiempo real (WebSocket) compartida.

Mantiene las conexiones en memoria del proceso ``uvicorn`` y las agrupa por
*topic* (canal lógico). La negociación de ofertas (plan 0004) y la ubicación en
vivo (plan 0003) reutilizan este mismo hub.
"""
