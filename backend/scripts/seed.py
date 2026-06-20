"""Seed idempotente de usuarios de prueba (pasajeros y conductores).

Crea, si no existen, dos usuarios por rol con la contraseña común ``ViajaYa1234#``.
Ejecutar con::

    python -m scripts.seed

Requiere la base de datos levantada y las migraciones aplicadas (``alembic upgrade head``).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from app.domain.entities import ServiceType, User, UserRole
from app.infrastructure.db.repositories import SqlAlchemyUserRepository
from app.infrastructure.db.session import async_session_factory
from app.infrastructure.security.bcrypt_hasher import BcryptPasswordHasher

SEED_PASSWORD = "ViajaYa1234#"


@dataclass(frozen=True)
class SeedUser:
    full_name: str
    email: str
    role: UserRole = UserRole.PASSENGER
    vehicle_type: ServiceType | None = None
    plate: str | None = None
    vehicle_model: str | None = None
    rating: float | None = None


SEED_USERS: list[SeedUser] = [
    SeedUser("Pasajero Uno", "passenger1@viajaya.com"),
    SeedUser("Pasajero Dos", "passenger2@viajaya.com"),
    SeedUser(
        "Conductor Auto Uno",
        "driver.auto1@viajaya.com",
        role=UserRole.DRIVER,
        vehicle_type=ServiceType.TAXI,
        plate="1234-ABC",
        vehicle_model="Toyota Corolla",
        rating=4.8,
    ),
    SeedUser(
        "Conductor Auto Dos",
        "driver.auto2@viajaya.com",
        role=UserRole.DRIVER,
        vehicle_type=ServiceType.TAXI,
        plate="5678-DEF",
        vehicle_model="Nissan Versa",
        rating=4.6,
    ),
    SeedUser(
        "Conductor Moto Uno",
        "driver.moto1@viajaya.com",
        role=UserRole.DRIVER,
        vehicle_type=ServiceType.MOTO,
        plate="M-101",
        vehicle_model="Honda CB125",
        rating=4.9,
    ),
    SeedUser(
        "Conductor Moto Dos",
        "driver.moto2@viajaya.com",
        role=UserRole.DRIVER,
        vehicle_type=ServiceType.MOTO,
        plate="M-202",
        vehicle_model="Yamaha YBR125",
        rating=4.7,
    ),
]


async def seed() -> None:
    hasher = BcryptPasswordHasher()
    hashed = hasher.hash(SEED_PASSWORD)

    async with async_session_factory() as session:
        users = SqlAlchemyUserRepository(session)
        created, skipped = 0, 0
        for seed_user in SEED_USERS:
            if await users.get_by_email(seed_user.email) is not None:
                skipped += 1
                print(f"= ya existe: {seed_user.email}")
                continue
            await users.add(
                User(
                    full_name=seed_user.full_name,
                    email=seed_user.email,
                    hashed_password=hashed,
                    role=seed_user.role,
                    vehicle_type=seed_user.vehicle_type,
                    plate=seed_user.plate,
                    vehicle_model=seed_user.vehicle_model,
                    rating=seed_user.rating,
                )
            )
            created += 1
            print(f"+ creado: {seed_user.email} ({seed_user.role.value})")

    print(f"\nSeed listo: {created} creados, {skipped} ya existían.")
    print(f"Contraseña común: {SEED_PASSWORD}")


if __name__ == "__main__":
    asyncio.run(seed())
