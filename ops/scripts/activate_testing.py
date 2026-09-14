"""Back up the isolated testing database and replace only its API service."""
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _workspace  # noqa: E402
import manage_testing as manager  # noqa: E402

ROOT = _workspace.phase_dir("phase02")
IMAGE = os.environ.get("VIAJAYA_API_IMAGE", "viajaya-phase2:runtime")
state = manager.read_state()
previous = state["images"]["api"]
new_image = manager.docker("image", "inspect", IMAGE, "--format", "{{.Id}}", capture=True)
database = manager.compose("ps", "-q", "testing-database", capture=True)
tunnel = manager.compose("ps", "-q", "testing-tunnel", capture=True)
backup = ROOT / ("testing-before-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + ".dump")
with backup.open("wb") as output:
    subprocess.run(["docker", "exec", database, "pg_dump", "-U", "viajaya_testing",
                    "-d", "viajaya_testing", "-Fc"], stdout=output, check=True)
assert backup.stat().st_size > 1000
state["images"]["api"] = new_image
state["phone_otp_enabled"] = True
manager.write_configuration(state)
manager.compose("run", "--rm", "--no-deps", "migrate")
manager.compose("up", "-d", "--no-deps", "testing-api")
# A tunnel container is optional: recent environments publish the API through a
# host-side tunnel instead. Only assert preservation when one was running.
if tunnel:
    assert manager.compose("ps", "-q", "testing-tunnel", capture=True) == tunnel
report = {"previous_image": previous, "image": new_image, "backup": str(backup),
          "api_url": state["api_url"], "tunnel_preserved": bool(tunnel), "phone_otp_enabled": True}
(ROOT / "testing-deployment.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"api_replaced": True, "backup_created": True,
                  "tunnel_preserved": bool(tunnel)}))
