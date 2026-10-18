#!/usr/bin/env python3
import json
import os
from pathlib import Path
import shlex
import subprocess
import tarfile
import tempfile

PROJECT_ID = "twenty-stuard-demo-product"
INSTANCE_NAME = "twenty-stuard-demo-product"
ZONE = "us-east1-b"
HOSTNAME = "twenty-stuard-demo-product.materic.inc"
BOOTSTRAP_IMAGE = "twentycrm/twenty:v2.48.0@sha256:43fab4bffacdcd63ff3c9257b7f8985a4424d81e9eb43982b9c16a841d555e52"


def main():
    exported = subprocess.run(
        ["infisical", "export", "--projectId", "c41f4ae6-3f02-4165-a4a4-3ea9043a6e6c",
         "--env", "dev", "--path", "/twenty-stuard-demo-product", "--format", "json", "--silent"],
        capture_output=True, text=True, check=True,
    )
    secret_values = {item["key"]: item["value"] for item in json.loads(exported.stdout)}
    environment = {}
    for name in ("APP_SECRET", "ENCRYPTION_KEY", "POSTGRES_PASSWORD"):
        value = secret_values.get(name, "")
        if not value or not all(character in "0123456789abcdef" for character in value):
            raise ValueError(f"Missing or unexpected format for Infisical key {name}")
        environment[name] = value
    environment.update({
        "TWENTY_IMAGE": BOOTSTRAP_IMAGE,
        "TWENTY_HOST": HOSTNAME,
        "SERVER_URL": "https://" + HOSTNAME,
        "API_RATE_LIMITING_LONG_LIMIT": "500",
    })

    selectors = ["--project", PROJECT_ID, "--zone", ZONE, "--tunnel-through-iap", "--quiet"]
    ssh = ["gcloud", "compute", "ssh", INSTANCE_NAME, *selectors]
    readiness_command = "set -eu; mountpoint -q /srv/twenty; test \"$(sudo docker info --format '{{.DockerRootDir}}')\" = /srv/twenty/docker"
    subprocess.run([*ssh, "--command", readiness_command], check=True)
    deploy_directory = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix="twenty-bootstrap-") as staging:
        staging_path = Path(staging)
        os.chmod(staging_path, 0o700)
        environment_file = staging_path / "runtime.env"
        environment_file.touch(mode=0o600)
        environment_file.write_text("".join(f"{key}={value}\n" for key, value in environment.items()))
        archive_file = staging_path / "deploy.tar"
        with tarfile.open(archive_file, "w") as archive:
            for name in ("compose.yaml", "Caddyfile", "entrypoint.sh", "twenty-demo-deploy"):
                archive.add(deploy_directory / name, arcname=name)
        remote_directory = "/tmp/" + staging_path.name
        subprocess.run([*ssh, "--command", "umask 077; mkdir -p " + shlex.quote(remote_directory)], check=True)
        subprocess.run([
            "gcloud", "compute", "scp", str(environment_file), str(archive_file),
            INSTANCE_NAME + ":" + remote_directory + "/", *selectors,
        ], check=True)
        command = f"""set -eu
sudo install -d -m 700 /etc/twenty-demo
sudo install -d -m 755 /srv/twenty/deploy
sudo install -m 600 {shlex.quote(remote_directory)}/runtime.env /etc/twenty-demo/.env
sudo tar -xf {shlex.quote(remote_directory)}/deploy.tar -C /srv/twenty/deploy
sudo install -m 755 /srv/twenty/deploy/twenty-demo-deploy /usr/local/sbin/twenty-demo-deploy
rm -rf {shlex.quote(remote_directory)}
sudo docker compose --env-file /etc/twenty-demo/.env -f /srv/twenty/deploy/compose.yaml up -d --wait --wait-timeout 900 server
sudo docker compose --env-file /etc/twenty-demo/.env -f /srv/twenty/deploy/compose.yaml up -d --wait --wait-timeout 180 worker
curl --fail --silent http://127.0.0.1:3000/healthz
"""
        subprocess.run([*ssh, "--command", command], check=True)
    print("Private Twenty server and worker are running. Public web ingress remains disabled.")
    print("Bootstrap the owner and seed through an IAP SSH tunnel before opening web ingress.")


if __name__ == "__main__":
    main()
