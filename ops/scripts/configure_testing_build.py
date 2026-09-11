"""Point only the EAS preview environment at the current public Testing API."""
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _workspace  # noqa: E402

WORKSPACE = _workspace.REPO
ROOT = _workspace.phase_dir("phase02")
state = _workspace.read_state()
api_url = state["api_url"]
assert api_url.startswith("https://") and api_url.endswith("/api/v1")
assert api_url.split("/")[2].endswith(
    (".trycloudflare.com", ".ngrok-free.dev", ".ngrok-free.app")
)
environment = {**os.environ, "APP_ENV": "testing", "EXPO_NO_DOTENV": "1",
               "TESTING_API_URL": api_url}
command = [
    *_workspace.eas_command(),
    "env:update", "preview", "--variable-name", "TESTING_API_URL", "--value", api_url,
    "--scope", "project", "--non-interactive",
]
with (ROOT / "eas-preview-url.log").open("w", encoding="utf-8") as output:
    subprocess.run(command, cwd=WORKSPACE / "mobile", env=environment,
                   stdout=output, stderr=subprocess.STDOUT, check=True)
print(json.dumps({"environment": "preview", "variable": "TESTING_API_URL", "api_url": api_url}))
