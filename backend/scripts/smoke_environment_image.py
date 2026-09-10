"""Exercise the runtime image against a disposable PostgreSQL database."""

from __future__ import annotations

import argparse
import json
import secrets
import subprocess
import time
import urllib.error
import urllib.request
import uuid

from jose import jwt


def docker(*arguments: str, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(
        ["docker", *arguments],
        capture_output=True,
        text=True,
        timeout=180,
    )
    if check and result.returncode:
        # Docker arguments can contain disposable credentials; never echo them.
        raise RuntimeError(f"Docker {arguments[0]} failed: {result.stderr[-2000:]}")
    return result


def request(
    base: str,
    path: str,
    payload: dict | None = None,
    token: str | None = None,
    environment: str = "testing",
):
    headers = {"Content-Type": "application/json", "X-App-Environment": environment}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(payload).encode() if payload is not None else None
    try:
        with urllib.request.urlopen(
            urllib.request.Request(base + path, data=data, headers=headers),
            timeout=5,
        ) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="viajaya-phase1:runtime")
    args = parser.parse_args()
    prefix = f"viajaya-f01-{uuid.uuid4().hex[:12]}"
    network = prefix + "-network"
    database = prefix + "-database"
    api = prefix + "-api"
    password, secret = secrets.token_hex(24), secrets.token_hex(32)
    resources: list[str] = []
    network_created = False
    try:
        docker("network", "create", network)
        network_created = True
        database_id = docker(
            "run",
            "--detach",
            "--name",
            database,
            "--network",
            network,
            "--network-alias",
            "database-testing.internal",
            "-e",
            "POSTGRES_USER=fixture",
            "-e",
            f"POSTGRES_PASSWORD={password}",
            "-e",
            "POSTGRES_DB=viajaya_testing",
            "postgres:16-alpine",
        ).stdout.strip()
        resources.append(database_id)
        for _ in range(60):
            if not docker("exec", database, "pg_isready", "-U", "fixture", check=False).returncode:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Disposable PostgreSQL did not become ready.")
        configuration = {
            "APP_ENV": "testing",
            "PUBLIC_API_URL": "https://api-testing.example.test/api/v1",
            "DATABASE_URL": f"postgresql+asyncpg://fixture:{password}@database-testing.internal/viajaya_testing",
            "JWT_SECRET": secret,
            "CORS_ORIGINS": "https://admin-testing.example.test",
            "REALTIME_REDIS_URL": "redis://cache-testing.internal:6379/0",
            "REALTIME_REDIS_CHANNEL": "viajaya:testing:realtime:v2",
            "REALTIME_PRESENCE_KEY_PREFIX": "viajaya:testing:presence:v1",
            "PAYMENT_MODE": "sandbox",
        }
        environment = [
            item for key, value in configuration.items() for item in ("-e", f"{key}={value}")
        ]
        docker(
            "run",
            "--rm",
            "--network",
            network,
            *environment,
            args.image,
            "python",
            "-m",
            "alembic",
            "upgrade",
            "head",
        )
        api_id = docker(
            "run",
            "--detach",
            "--name",
            api,
            "--network",
            network,
            "--publish",
            "127.0.0.1::8000",
            "--read-only",
            "--tmpfs",
            "/tmp",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges:true",
            *environment,
            args.image,
        ).stdout.strip()
        resources.append(api_id)
        port = docker("port", api, "8000/tcp").stdout.strip().split(":")[-1]
        base = f"http://127.0.0.1:{int(port)}"
        for _ in range(45):
            try:
                if request(base, "/health/ready")[0] == 200:
                    break
            except (OSError, ValueError):
                pass
            time.sleep(1)
        else:
            raise RuntimeError("The isolated API did not become ready.")
        status, registered = request(
            base,
            "/api/v1/auth/register",
            {
                "full_name": "Environment Smoke",
                "email": "smoke@example.com",
                "password": "Smoke-test-only-1234",
                "phone": "+59170000001",
            },
        )
        assert status == 201, f"Registration failed with HTTP {status}"
        tokens = registered["tokens"]
        claims = jwt.decode(
            tokens["access_token"],
            secret,
            algorithms=["HS256"],
            issuer="viajaya:testing",
            audience="viajaya:mobile:testing",
        )
        assert request(base, "/api/v1/auth/me", token=tokens["access_token"])[0] == 200
        assert (
            request(base, "/api/v1/auth/refresh", {"refresh_token": tokens["refresh_token"]})[0]
            == 200
        )
        claims.update(iss="viajaya:production", aud="viajaya:mobile:production")
        crossed = jwt.encode(claims, secret, algorithm="HS256")
        assert request(base, "/api/v1/auth/me", token=crossed)[0] == 401
        assert request(base, "/api/v1/auth/login", {}, environment="development")[0] == 400
        unsafe = docker(
            "run",
            "--rm",
            args.image,
            "python",
            "-c",
            ("from app.infrastructure.config import Settings; Settings(_env_file=None)"),
            check=False,
        )
        assert unsafe.returncode != 0, "The runtime image accepted unsafe production defaults"
        docker(
            "exec",
            api,
            "python",
            "-c",
            (
                "import os; from pathlib import Path; "
                "assert os.getuid() == 10001; assert not Path('/app/.env').exists()"
            ),
        )
        print(
            json.dumps(
                {
                    "image": args.image,
                    "migrations": "passed",
                    "readiness": "passed",
                    "auth": "passed",
                    "cross_environment_token": "rejected",
                    "cross_environment_login": "rejected",
                    "unsafe_production_defaults": "rejected",
                    "non_root": True,
                }
            )
        )
    finally:
        # Remove only container IDs created by this invocation, never existing services.
        for container_id in reversed(resources):
            docker("rm", "--force", "--volumes", container_id, check=False)
        if network_created:
            docker("network", "rm", network, check=False)


if __name__ == "__main__":
    main()
