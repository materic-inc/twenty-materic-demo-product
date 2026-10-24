#!/usr/bin/env python3
import json
import re
import subprocess
import sys


def main():
    service = sys.argv[1] if len(sys.argv) > 1 else "server"
    if service not in ("server", "worker", "postgres", "redis", "proxy"):
        raise ValueError("Unknown demo service")
    exported = subprocess.run(
        ["infisical", "export", "--projectId", "c41f4ae6-3f02-4165-a4a4-3ea9043a6e6c",
         "--env", "dev", "--path", "/twenty-materic-demo-product", "--format", "json", "--silent"],
        capture_output=True, text=True, check=True,
    )
    secrets = [item["value"] for item in json.loads(exported.stdout) if len(item.get("value", "")) > 5]
    logs = subprocess.run(
        ["gcloud", "compute", "ssh", "twenty-stuard-demo-product", "--project", "twenty-stuard-demo-product",
         "--zone", "us-east1-b", "--tunnel-through-iap", "--quiet", "--command",
         f"sudo docker logs --tail 30 twenty-stuard-demo-product-{service}-1"],
        capture_output=True, text=True,
    )
    output = logs.stdout + logs.stderr
    for value in sorted(secrets, key=len, reverse=True):
        output = output.replace(value, "<redacted>")
    print(re.sub(r"\x1b\[[0-9;]*m", "", output))
    return logs.returncode


if __name__ == "__main__":
    sys.exit(main())
