"""Shared locations and tool discovery for the operational scripts.

These scripts drive machine-local resources: the disposable testing stack, its
private state, database backups and the Android artifacts. None of that belongs
in the repository, so every path is resolved at runtime and can be overridden
with an environment variable. The defaults reproduce the layout used while
F01 and F02 were built, so an existing workstation keeps working unchanged.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

_DEFAULT_BUILD_TOOLS = "tools/android/build-tools-36.0.0/android-16"


def work_dir() -> Path:
    """Directory holding machine-local artifacts: state, backups, logs, APKs."""
    override = os.environ.get("VIAJAYA_WORK_DIR")
    return Path(override).resolve() if override else (REPO / "local-files").resolve()


def state_path() -> Path:
    """Private state of the disposable testing environment."""
    override = os.environ.get("VIAJAYA_TESTING_STATE")
    if override:
        return Path(override).resolve()
    return work_dir() / "phase01/testing/private-state.json"


def state_dir() -> Path:
    return state_path().parent


def read_state() -> dict:
    return json.loads(state_path().read_text(encoding="utf-8"))


def phase_dir(name: str) -> Path:
    """Artifact directory for one delivery phase, created on demand."""
    directory = work_dir() / name
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def apk_dir() -> Path:
    """Directory holding downloaded Android artifacts."""
    override = os.environ.get("VIAJAYA_APK_DIR")
    return Path(override).resolve() if override else phase_dir("phase01") / "apks"


def android_build_tools() -> Path:
    override = os.environ.get("VIAJAYA_ANDROID_BUILD_TOOLS")
    tools = Path(override).resolve() if override else work_dir() / _DEFAULT_BUILD_TOOLS
    if not tools.is_dir():
        raise SystemExit(
            f"Android build tools not found at {tools}. "
            "Install them or set VIAJAYA_ANDROID_BUILD_TOOLS."
        )
    return tools


def eas_command() -> list[str]:
    """Resolve the EAS CLI without assuming a particular installation."""
    override = os.environ.get("VIAJAYA_EAS_COMMAND")
    if override:
        return override.split()
    executable = shutil.which("eas")
    if executable:
        return [executable]
    npx = shutil.which("npx")
    if npx:
        return [npx, "--yes", "eas-cli"]
    raise SystemExit(
        "The EAS CLI is unavailable. Install it, or set VIAJAYA_EAS_COMMAND "
        "to the command that runs it."
    )


def development_origin() -> str:
    return os.environ.get("VIAJAYA_DEVELOPMENT_ORIGIN", "http://127.0.0.1:8000").rstrip("/")


def testing_origin() -> str:
    """Local origin of the testing API, before any public tunnel."""
    return os.environ.get("VIAJAYA_TESTING_ORIGIN", "http://127.0.0.1:8001").rstrip("/")


def development_api_url() -> str:
    """Public API URL baked into the development build, taken from mobile/.env."""
    override = os.environ.get("VIAJAYA_DEVELOPMENT_API_URL")
    if override:
        return override
    environment_file = REPO / "mobile/.env"
    if environment_file.is_file():
        for line in environment_file.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() == "API_URL":
                return value.strip().strip('"').strip("'")
    raise SystemExit(
        "API_URL is missing from mobile/.env. Set it, or export "
        "VIAJAYA_DEVELOPMENT_API_URL with the URL the development build uses."
    )
