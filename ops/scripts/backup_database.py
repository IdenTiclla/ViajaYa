"""Save a custom-format database backup before applying additive account migrations."""
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _workspace  # noqa: E402

label = sys.argv[1] if len(sys.argv) > 1 else "development"
container = sys.argv[2] if len(sys.argv) > 2 else "viajaya_db"
backup = _workspace.phase_dir("backups") / (
    f"{label}-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + ".dump")
with backup.open("wb") as output:
    subprocess.run(["docker", "exec", container, "sh", "-c",
                    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],
                   stdout=output, check=True)
assert backup.stat().st_size > 1000
print(f"{label} backup created: {backup}")
