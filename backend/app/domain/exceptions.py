"""Domain exceptions.

They are framework-independent. The API layer translates them into HTTP responses
in ``app/api/errors.py`` (a single mapping point, DRY principle).
"""


class DomainError(Exception):
    """Base exception for business-rule errors."""


class InvalidCredentialsError(DomainError):
    """The credentials (email/password) are not valid."""


class InvalidEmailError(DomainError):
    """The email format is not valid."""


class InvalidTokenError(DomainError):
    """The token (our own or an OAuth provider's) is invalid or expired."""


class UnsupportedProviderError(DomainError):
    """The requested OAuth provider is not supported."""


class InvalidLocationError(DomainError):
    """The coordinates of a ride point are out of range."""


class InvalidFareError(DomainError):
    """The fare offered for the ride is not valid (it must be greater than zero)."""


class SavedPlaceNotFoundError(DomainError):
    """The saved place does not exist or does not belong to the current user."""


class RideNotFoundError(DomainError):
    """La solicitud de viaje no existe."""


class RideAlreadyActiveError(DomainError):
    """The passenger already has an active request or ride."""


class OfferNotFoundError(DomainError):
    """The offer does not exist or does not belong to the given request."""


class InvalidRideTransitionError(DomainError):
    """The ride status transition is not allowed from the current status."""


class NotAuthorizedActionError(DomainError):
    """The user is not allowed to perform this action (role or ownership)."""


class DriverUnavailableError(DomainError):
    """The driver was already assigned to another ride (lost the race to accept).

    This is the "golden rule": when a driver offers to several passengers, only the
    first one to accept gets them; any later attempt receives this error.
    """


class RideNotCompletedError(DomainError):
    """A ride that is not completed yet cannot be rated."""


class AlreadyRatedError(DomainError):
    """The user already rated this ride."""


class InvalidRatingError(DomainError):
    """The rating is outside the allowed range (1–5)."""


class InvalidDriverApplicationError(DomainError):
    """The driver application is inconsistent (services outside the vehicle, bad plate…)."""


class DriverVehicleNotFoundError(DomainError):
    """The user has no registered vehicle of that type."""
