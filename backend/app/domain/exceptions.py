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


class SavedPlaceNotFoundError(DomainError):
    """El lugar guardado no existe o no pertenece al usuario actual."""


class RideNotFoundError(DomainError):
    """La solicitud de viaje no existe."""


class RideAlreadyActiveError(DomainError):
    """El pasajero ya tiene una solicitud o un viaje activo."""


class OfferNotFoundError(DomainError):
    """La oferta no existe o no pertenece a la solicitud indicada."""


class InvalidRideTransitionError(DomainError):
    """La transición de estado del viaje no está permitida desde el estado actual."""


class NotAuthorizedActionError(DomainError):
    """El usuario no tiene permiso para ejecutar esta acción (rol o propiedad)."""


class DriverUnavailableError(DomainError):
    """El conductor ya fue asignado a otro viaje (perdió la carrera por aceptar).

    Es la "regla de oro": cuando un conductor oferta a varios pasajeros, solo el
    primero que acepta se lo queda; cualquier intento posterior recibe este error.
    """


class RideNotCompletedError(DomainError):
    """No se puede calificar un viaje que aún no está completado."""


class AlreadyRatedError(DomainError):
    """El usuario ya calificó este viaje."""


class InvalidRatingError(DomainError):
    """La calificación está fuera del rango permitido (1–5)."""
