"""Idempotent seed of test accounts (passengers and drivers) with verified phones.

Every seeded account signs in through the phone flow: request a code for its
number and use the mock OTP that Desarrollo/Pruebas return. Run with::

    python -m scripts.seed

Requires the database up and migrations applied (``alembic upgrade head``).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime

from app.domain.entities import User, UserRole, VehicleType
from app.infrastructure.config import get_settings
from app.infrastructure.db.account_access import SqlAlchemyPhoneAccountRepository
from app.infrastructure.db.session import async_session_factory


@dataclass(frozen=True)
class SeedUser:
    full_name: str
    phone: str
    role: UserRole = UserRole.PASSENGER
    vehicle_type: VehicleType | None = None
    plate: str | None = None
    vehicle_model: str | None = None
    rating: float | None = None


SEED_USERS: list[SeedUser] = [
    SeedUser("Pasajero Uno", "+59170000001"),
    SeedUser("Pasajero Dos", "+59170000002"),
    SeedUser(
        "Conductor Auto Uno",
        "+59170000011",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
        plate="1234-ABC",
        vehicle_model="Toyota Corolla",
        rating=4.8,
    ),
    SeedUser(
        "Conductor Auto Dos",
        "+59170000012",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.TAXI,
        plate="5678-DEF",
        vehicle_model="Nissan Versa",
        rating=4.6,
    ),
    SeedUser(
        "Conductor Moto Uno",
        "+59170000021",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.MOTO,
        plate="M-101",
        vehicle_model="Honda CB125",
        rating=4.9,
    ),
    SeedUser(
        "Conductor Moto Dos",
        "+59170000022",
        role=UserRole.DRIVER,
        vehicle_type=VehicleType.MOTO,
        plate="M-202",
        vehicle_model="Yamaha YBR125",
        rating=4.7,
    ),
]


async def seed() -> None:
    now = datetime.now(UTC)
    terms_version = get_settings().phone_terms_version

    async with async_session_factory() as session:
        accounts = SqlAlchemyPhoneAccountRepository(session)
        created, skipped = 0, 0
        for seed_user in SEED_USERS:
            if await accounts.find_by_phone(seed_user.phone) is not None:
                skipped += 1
                print(f"= ya existe: {seed_user.phone}")
                continue
            user = await accounts.create(
                User(
                    full_name=seed_user.full_name,
                    email=None,
                    role=seed_user.role,
                    vehicle_type=seed_user.vehicle_type,
                    plate=seed_user.plate,
                    vehicle_model=seed_user.vehicle_model,
                    rating=seed_user.rating,
                )
            )
            await accounts.set_verified_phone(user.id, seed_user.phone, now)
            await accounts.accept_terms(user.id, terms_version, now)
            created += 1
            print(f"+ creado: {seed_user.phone} ({seed_user.role.value})")
        await session.commit()

    print(f"\nSeed listo: {created} creados, {skipped} ya existían.")
    print("Entra con cualquiera de esos números y el OTP simulado del entorno.")


if __name__ == "__main__":
    asyncio.run(seed())
