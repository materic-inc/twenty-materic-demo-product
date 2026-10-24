#!/usr/bin/env python3
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shlex
import subprocess

REMOTE_RESTORE = r'''
import json, pathlib, subprocess, uuid
baseline = BASELINE_NAME
backup = pathlib.Path('/srv/twenty/backups') / baseline
expected = [json.loads(line) for line in (backup / 'counts.ndjson').read_text().splitlines() if line.strip()]
if not expected:
    raise RuntimeError('Baseline has no workspace count manifest')
database = 'twenty_materic_demo_restore_' + uuid.uuid4().hex[:16]
container = 'twenty-stuard-demo-product-postgres-1'
prefix = ['docker', 'exec', '-i', container]
def run(arguments, **kwargs):
    result = subprocess.run(prefix + arguments, capture_output=True, **kwargs)
    if result.returncode:
        (backup / 'restore-verification-errors.log').write_bytes(result.stderr)
        (backup / 'restore-verification-errors.log').chmod(0o600)
        raise RuntimeError('Temporary database verification command failed; private diagnostics saved on VM')
    return result.stdout
run(['createdb', '-U', 'twenty', database])
try:
    with (backup / 'database.dump').open('rb') as archive:
        run(['pg_restore', '-U', 'twenty', '--no-owner', '--no-privileges', '-d', database], stdin=archive)
    actual = []
    for workspace in expected:
        schema = '"' + workspace['schema'].replace('"', '""') + '"'
        counts = {'schema': workspace['schema']}
        for key, table in [('companies', 'company'), ('people', 'person'), ('opportunities', 'opportunity')]:
            sql = 'SELECT count(*) FROM ' + schema + '."' + table + '" WHERE "deletedAt" IS NULL'
            counts[key] = int(run(['psql', '-U', 'twenty', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]))
        actual.append(counts)
    report = {'baseline': baseline, 'temporaryDatabase': database, 'expected': expected, 'restored': actual, 'countsMatch': actual == expected}
finally:
    run(['dropdb', '-U', 'twenty', database])
report['temporaryDatabaseDropped'] = True
print(json.dumps(report))
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    if not re.fullmatch(r"twenty-(stuard|materic)-demo-baseline-[a-z0-9-]+", arguments.baseline):
        raise ValueError("Unexpected baseline name")
    program = REMOTE_RESTORE.replace("BASELINE_NAME", repr(arguments.baseline))
    result = subprocess.run(
        ["gcloud", "compute", "ssh", "twenty-stuard-demo-product", "--project", "twenty-stuard-demo-product",
         "--zone", "us-east1-b", "--tunnel-through-iap", "--quiet", "--command", "sudo python3 -c " + shlex.quote(program)],
        capture_output=True, text=True, check=True,
    )
    report = json.loads(result.stdout)
    report["verifiedAt"] = datetime.now(timezone.utc).isoformat()
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(report, indent=2) + "\n")
    if not report["countsMatch"]:
        raise SystemExit("Restored counts differ from the golden baseline")
    print("Golden database restored, counts matched, and only the temporary verification database was dropped.")


if __name__ == "__main__":
    main()
