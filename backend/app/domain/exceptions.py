"""Excepciones del dominio.

Son independientes del framework. La capa de API las traduce a respuestas HTTP
en ``app/api/errors.py`` (un único punto de mapeo, principio DRY).
"""


class DomainError(Exception):
    """Excepción base para errores de reglas de negocio."""


class EmailAlreadyExistsError(DomainError):
    """Ya existe un usuario registrado con ese correo."""


class InvalidCredentialsError(DomainError):
    """Las credenciales (email/contraseña) no son válidas."""


class InvalidEmailError(DomainError):
    """El formato del correo no es válido."""


class WeakPasswordError(DomainError):
    """La contraseña no cumple los requisitos mínimos."""


class InvalidTokenError(DomainError):
    """El token (propio o de un proveedor OAuth) es inválido o expiró."""


class UnsupportedProviderError(DomainError):
    """El proveedor de OAuth solicitado no está soportado."""


class InvalidLocationError(DomainError):
    """Las coordenadas de un punto del viaje están fuera de rango."""


class InvalidFareError(DomainError):
    """El monto ofertado para el viaje no es válido (debe ser mayor que cero)."""
