"""Verify the mobile-only upload and request one internal Testing APK build."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _workspace  # noqa: E402

WORKSPACE = _workspace.REPO
ROOT = _workspace.phase_dir("phase02")
ARCHIVE = ROOT / "eas-testing-archive"
reviewed = []
for file in ARCHIVE.rglob("*"):
    if not file.is_file():
        continue
    relative = file.relative_to(ARCHIVE)
    assert relative.parts[0] == "mobile" or relative.as_posix() == ".easignore"
    assert not any(part.startswith(".env") or part in {".git", "node_modules", "local-files"}
                   for part in relative.parts)
    assert file.suffix not in {".jks", ".keystore", ".pem", ".key", ".p12", ".p8"}
    source = WORKSPACE / relative
    assert source.is_file(), relative
    if source.read_bytes() != file.read_bytes():
        shutil.copyfile(source, file)
    reviewed.append({"path": relative.as_posix(),
                     "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
assert any(row["path"].endswith("PhoneEntryScreen.tsx") for row in reviewed)
assert any(row["path"].endswith("AccountSecurityPanel.tsx") for row in reviewed)
(ROOT / "eas-archive-review.json").write_text(
    json.dumps({"files": reviewed}, indent=2), encoding="utf-8"
)
if "--review-only" in sys.argv:
    print(json.dumps({"reviewed_files": len(reviewed), "private_files_included": False,
                      "destination": "EAS @iden/viajaya", "profile": "preview"}))
    raise SystemExit(0)
state = _workspace.read_state()
verification_path = ROOT / "live-phone-verification.json"
if not verification_path.is_file():
    raise SystemExit("Public Testing verification is missing; no EAS build was requested.")
verification = json.loads(verification_path.read_text(encoding="utf-8"))
if verification.get("testing", {}).get("api_url") != state["api_url"]:
    raise SystemExit(
        "Public verification does not match the current Testing URL; "
        "no EAS build was requested."
    )
with httpx.Client(timeout=15, headers={"X-App-Environment": "testing"}) as client:
    ready = client.get(state["api_url"].removesuffix("/api/v1") + "/health/ready")
    ready.raise_for_status()
    assert ready.headers["X-App-Environment"] == "testing"
if "--preflight-only" in sys.argv:
    print(json.dumps({"public_testing_preflight": "passed", "upload_started": False}))
    raise SystemExit(0)
mobile_values = dotenv_values(WORKSPACE / "mobile/.env")
environment = {**os.environ, "APP_ENV": "testing", "EXPO_NO_DOTENV": "1",
               "TESTING_API_URL": state["api_url"], "TESTING_OTP_TEST_AUTOFILL": "true"}
environment["TESTING_GOOGLE_MAPS_API_KEY_ANDROID"] = (
    mobile_values.get("TESTING_GOOGLE_MAPS_API_KEY_ANDROID")
    or mobile_values.get("GOOGLE_MAPS_API_KEY_ANDROID") or ""
)
assert environment["TESTING_GOOGLE_MAPS_API_KEY_ANDROID"]
with (ROOT / "eas-testing-build.json").open("w", encoding="utf-8") as output, (
    ROOT / "eas-testing-build.stderr.log"
).open("w", encoding="utf-8") as errors:
    result = subprocess.run([*_workspace.eas_command(), "build", "--platform", "android",
                             "--profile", "preview", "--non-interactive", "--no-wait", "--json"],
                            cwd=WORKSPACE / "mobile", env=environment, stdout=output, stderr=errors)
if result.returncode:
    raise SystemExit("EAS build request failed; inspect the local build log.")
builds = json.loads((ROOT / "eas-testing-build.json").read_text(encoding="utf-8"))
build = builds[0]
(ROOT / "testing-build-id.txt").write_text(build["id"], encoding="utf-8")
print(json.dumps({"id": build["id"], "status": build["status"], "profile": build["buildProfile"],
                  "reviewed_files": len(reviewed)}))
