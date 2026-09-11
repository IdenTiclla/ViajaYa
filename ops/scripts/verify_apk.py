"""Check the downloaded APK, embedded environment, native identity, and signature."""

import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _workspace  # noqa: E402

TOOLS = _workspace.android_build_tools()
APKS = _workspace.apk_dir()
environment = sys.argv[1]
assert environment in {"development", "testing"}
label = "Desarrollo" if environment == "development" else "Pruebas"
package = "com.viajaya.app.dev" if environment == "development" else "com.viajaya.app.testing"
scheme = "viajaya-dev" if environment == "development" else "viajaya-testing"
apk_path = APKS / f"ViajaYa-{label}.apk"
api_url = (_workspace.development_api_url() if environment == "development"
           else _workspace.read_state()["api_url"])

with zipfile.ZipFile(apk_path) as archive:
    assert archive.testzip() is None, "APK ZIP integrity failed."
    config = json.loads(archive.read("assets/app.config"))
    bundled_javascript = "assets/index.android.bundle" in archive.namelist()
    assert config["name"] == f"ViajaYa {label}"
    assert config["android"]["package"] == package
    assert config["scheme"] == scheme
    assert config["extra"]["appEnv"] == environment
    assert config["extra"]["apiUrl"] == api_url
    assert config["extra"]["otpMode"] == "mock"
    assert config["extra"]["otpTestAutofill"] is True
    assert config["updates"]["enabled"] is False
    if environment == "testing":
        assert bundled_javascript, "Testing APK must contain its own JavaScript bundle."

aapt = str(TOOLS / ("aapt2.exe" if os.name == "nt" else "aapt2"))
badging = subprocess.check_output([aapt, "dump", "badging", str(apk_path)], encoding="utf-8")
assert f"package: name='{package}'" in badging
assert f"application-label:'ViajaYa {label}'" in badging
manifest = subprocess.check_output(
    [aapt, "dump", "xmltree", str(apk_path), "--file", "AndroidManifest.xml"], encoding="utf-8"
)
assert scheme in manifest
lines = manifest.splitlines()
maps_line = next(index for index, line in enumerate(lines)
                 if "com.google.android.geo.API_KEY" in line)
assert re.search(r'android:value.*="[^"]+"', lines[maps_line + 1]), "Native Maps key is empty."

signature = subprocess.check_output([
    "docker", "run", "--rm", "--network", "none", "--read-only", "--tmpfs", "/tmp",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--mount", f"type=bind,source={APKS},target=/apks,readonly",
    "--mount", f"type=bind,source={TOOLS / 'lib'},target=/tools,readonly",
    "eclipse-temurin@sha256:27cc0849148c0fd32ee8e95988917becf9bc96a3182a24f99d9763aa8e90f8cb",
    "java", "-jar", "/tools/apksigner.jar", "verify", "--verbose", "--print-certs",
    f"/apks/{apk_path.name}",
], encoding="utf-8")
assert "Verifies" in signature
certificate_sha1 = re.search(r"certificate SHA-1 digest: ([a-f0-9]+)", signature).group(1)
certificate_sha256 = re.search(r"certificate SHA-256 digest: ([a-f0-9]+)", signature).group(1)
with apk_path.open("rb") as stream:
    digest = hashlib.file_digest(stream, "sha256").hexdigest()
report = {
    "environment": environment, "apk": str(apk_path), "name": config["name"],
    "package": package, "api_url": api_url, "bytes": apk_path.stat().st_size,
    "sha256": digest, "zip_integrity": "passed", "embedded_configuration": "passed",
    "native_identity": "passed", "native_maps_key": "present", "signature": "passed",
    "bundled_javascript": bundled_javascript,
    "certificate_sha1": certificate_sha1, "certificate_sha256": certificate_sha256,
    "phone_installation_verified": False,
}
(_workspace.phase_dir("phase01") / f"{environment}-apk-verification.json").write_text(
    json.dumps(report, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(report))
