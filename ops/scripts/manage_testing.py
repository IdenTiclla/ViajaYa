"""Manage the isolated, temporary testing environment without changing private .env files."""

from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _workspace  # noqa: E402

WORKSPACE = _workspace.REPO
STATE_PATH = _workspace.state_path()
COMPOSE_PATH = _workspace.state_dir() / "compose.json"
PROJECT = os.environ.get("VIAJAYA_TESTING_PROJECT", "viajaya-testing-local")


def docker(*arguments: str, capture: bool = False, **kwargs: object) -> str:
    result = subprocess.run(
        ["docker", *arguments], check=True, encoding="utf-8",
        stdout=subprocess.PIPE if capture else None, **kwargs,
    )
    return result.stdout.strip() if capture else ""


def compose(*arguments: str, **kwargs: object) -> str:
    return docker("compose", "-f", str(COMPOSE_PATH), "-p", PROJECT, *arguments, **kwargs)


def image_id(reference: str) -> str:
    """Return the local image id, or an empty string when it is not present."""
    try:
        return docker("image", "inspect", reference, "--format", "{{.Id}}",
                      capture=True, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        return ""


def read_state() -> dict:
    return json.loads(STATE_PATH.read_text(encoding="utf-8"))


def write_configuration(state: dict) -> None:
    api_url = state.get("api_url", "https://not-configured.invalid/api/v1")
    origin = api_url.removesuffix("/api/v1")
    environment = {
        "APP_ENV": "testing",
        "PUBLIC_API_URL": api_url,
        "DATABASE_URL": (
            f"postgresql+asyncpg://viajaya_testing:{state['database_password']}"
            "@testing-database:5432/viajaya_testing"
        ),
        "JWT_SECRET": state["jwt_secret"],
        "JWT_ISSUER": "viajaya:testing",
        "JWT_AUDIENCE": "viajaya:mobile:testing",
        "CORS_ORIGINS": origin,
        "STORAGE_NAMESPACE": "viajaya-testing",
        "REALTIME_REDIS_URL": "redis://testing-cache:6379/0",
        "REALTIME_REDIS_CHANNEL": "viajaya:testing:realtime:v2",
        "REALTIME_PRESENCE_KEY_PREFIX": "viajaya:testing:presence:v1",
        "OTP_MODE": "mock",
        "OTP_TEST_AUTOFILL": "true",
        "PHONE_OTP_ENABLED": str(state.get("phone_otp_enabled", False)).lower(),
        "PAYMENT_MODE": "sandbox",
        "EMAIL_MODE": "mock",
        "PUSH_MODE": "mock",
        "REALTIME_OUTBOX_RECORDING_ENABLED": "false",
        "REALTIME_OUTBOX_DISPATCH_MODE": "off",
        "REALTIME_SHARED_PRESENCE_ENABLED": "false",
        "SCHEDULED_ACTIONS_MODE": "off",
    }
    api = {
        "image": state["images"]["api"],
        "environment": environment,
        "read_only": True,
        "tmpfs": ["/tmp"],
        "security_opt": ["no-new-privileges:true"],
        "cap_drop": ["ALL"],
        "depends_on": {"testing-database": {"condition": "service_healthy"}},
    }
    configuration = {
        "name": PROJECT,
        "services": {
            "testing-database": {
                "image": state["images"]["database"],
                "environment": {
                    "POSTGRES_USER": "viajaya_testing",
                    "POSTGRES_PASSWORD": state["database_password"],
                    "POSTGRES_DB": "viajaya_testing",
                },
                "volumes": ["testing_database:/var/lib/postgresql/data"],
                "healthcheck": {
                    "test": ["CMD-SHELL", "pg_isready -U viajaya_testing -d viajaya_testing"],
                    "interval": "3s", "timeout": "3s", "retries": 20,
                },
            },
            "testing-cache": {
                "image": state["images"]["cache"],
                "healthcheck": {
                    "test": ["CMD", "redis-cli", "ping"],
                    "interval": "3s", "timeout": "3s", "retries": 20,
                },
            },
            "testing-api": {**api, "ports": ["127.0.0.1:8001:8000"]},
            "migrate": {
                **api, "profiles": ["setup"],
                "command": ["python", "-m", "alembic", "upgrade", "head"],
                "healthcheck": {"disable": True},
            },
        },
        "volumes": {"testing_database": {}},
    }
    if state["images"].get("tunnel"):
        configuration["services"]["testing-tunnel"] = {
            "image": state["images"]["tunnel"],
            "command": ["tunnel", "--no-autoupdate", "--protocol", "http2",
                        "--url", "http://testing-api:8000"],
            "read_only": True,
            "tmpfs": ["/tmp"],
            "security_opt": ["no-new-privileges:true"],
            "cap_drop": ["ALL"],
        }
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    COMPOSE_PATH.write_text(json.dumps(configuration, indent=2) + "\n", encoding="utf-8")


def initialize() -> None:
    if STATE_PATH.exists():
        write_configuration(read_state())
        return
    existing = docker("ps", "-a", "--filter", f"label=com.docker.compose.project={PROJECT}",
                      "--format", "{{.ID}}", capture=True)
    if existing:
        raise RuntimeError(
            "Testing containers already exist without the corresponding private state."
        )
    required = {"api": os.environ.get("VIAJAYA_API_IMAGE", "viajaya-phase1:runtime"),
                "database": "postgres:16-alpine", "cache": "redis:7.4-alpine"}
    images = {
        key: docker("image", "inspect", image, "--format", "{{.Id}}", capture=True)
        for key, image in required.items()
    }
    images["tunnel"] = image_id("cloudflare/cloudflared:latest")
    write_configuration({
        "images": images,
        "database_password": secrets.token_hex(24),
        "jwt_secret": secrets.token_hex(48),
        "account_password": "Testing-" + secrets.token_urlsafe(14) + "!9",
    })


def set_url(api_url: str) -> None:
    """Point the environment at the public URL its build will be compiled against."""
    if not api_url.startswith("https://") or not api_url.endswith("/api/v1"):
        raise SystemExit("The URL must start with https:// and end with /api/v1.")
    state = read_state()
    state["api_url"] = api_url
    write_configuration(state)
    print(json.dumps({"environment": "testing", "api_url": api_url}))


def capture_url() -> None:
    logs = compose("logs", "--no-color", "--tail", "150", "testing-tunnel", capture=True)
    urls = re.findall(r"https://[a-z0-9-]+\.trycloudflare\.com", logs)
    if not urls:
        raise RuntimeError("The temporary HTTPS URL is not ready yet.")
    state = read_state()
    state["api_url"] = urls[-1] + "/api/v1"
    write_configuration(state)
    print(json.dumps({"environment": "testing", "api_url": state["api_url"]}))


def seed_accounts() -> None:
    state = read_state()
    source = (WORKSPACE / "backend/scripts/seed.py").read_text(encoding="utf-8")
    container = compose("ps", "-q", "testing-api", capture=True)
    payload = (
        "import asyncio, contextlib, io, json, os, sys, types\n"
        "from app.infrastructure.config import get_settings\n"
        "assert get_settings().app_env == 'testing'\n"
        "module = types.ModuleType('testing_seed')\n"
        "sys.modules['testing_seed'] = module\n"
        f"exec({source!r}, module.__dict__)\n"
        "module.SEED_PASSWORD = os.environ['TESTING_ACCOUNT_PASSWORD']\n"
        "with contextlib.redirect_stdout(io.StringIO()):\n"
        "    asyncio.run(module.seed())\n"
        "print(json.dumps({'seeded_test_accounts': len(module.SEED_USERS)}))\n"
    )
    docker("exec", "-i", "--env", "TESTING_ACCOUNT_PASSWORD", container, "python", "-",
           input=payload, env={**os.environ, "TESTING_ACCOUNT_PASSWORD": state["account_password"]})
    accounts = {
        "api_url": state["api_url"], "password": state["account_password"],
        "passengers": ["passenger1@viajaya.com", "passenger2@viajaya.com"],
        "drivers": ["driver.auto1@viajaya.com", "driver.auto2@viajaya.com",
                    "driver.moto1@viajaya.com", "driver.moto2@viajaya.com"],
    }
    (_workspace.state_dir() / "test-accounts.json").write_text(
        json.dumps(accounts, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    action = sys.argv[1]
    if action == "prepare":
        initialize()
        compose("config", "--quiet")
        print(json.dumps({"configuration": "verified", "project": PROJECT}))
    elif action == "start-infrastructure":
        compose("up", "-d", "testing-database", "testing-cache", "testing-tunnel")
    elif action == "capture-url":
        capture_url()
    elif action == "set-url":
        set_url(sys.argv[2])
    elif action == "start-api":
        assert "api_url" in read_state(), "Capture the real HTTPS URL before starting the API."
        compose("run", "--rm", "-T", "migrate")
        compose("up", "-d", "testing-api")
    elif action == "seed":
        seed_accounts()
    elif action == "status":
        compose("ps")
    else:
        raise ValueError("Unknown operation.")
