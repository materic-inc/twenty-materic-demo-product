#!/usr/bin/env python3
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shlex
import socket
import ssl
import subprocess
import urllib.request

PROJECT = "twenty-stuard-demo-product"
ZONE = "us-east1-b"
HOST = "twenty-stuard-demo-product.materic.inc"

REMOTE_INSPECTION = r'''
import glob, json, os, pathlib, subprocess, tomllib
def command(arguments):
    return subprocess.check_output(arguments, text=True).strip()
services = {}
for service in ['server', 'worker', 'postgres', 'redis', 'proxy']:
    item = json.loads(command(['docker', 'inspect', 'twenty-stuard-demo-product-' + service + '-1']))[0]
    environment = dict(value.split('=', 1) for value in item['Config']['Env'] if '=' in value)
    services[service] = {
        'image': item['Config']['Image'],
        'running': item['State']['Running'],
        'health': item['State'].get('Health', {}).get('Status'),
        'restarts': item['RestartCount'],
        'ports': item['NetworkSettings']['Ports'],
        'apiRateLimit': environment.get('API_RATE_LIMITING_LONG_LIMIT'),
        'disableDatabaseMigrations': environment.get('DISABLE_DB_MIGRATIONS'),
        'disableCronRegistration': environment.get('DISABLE_CRON_JOBS_REGISTRATION'),
    }
environment_stat = os.stat('/etc/twenty-demo/.env')
current_image = pathlib.Path('/srv/twenty/current-image').read_text().strip()
result = {
    'services': services,
    'dockerRoot': command(['docker', 'info', '--format', '{{.DockerRootDir}}']),
    'containerdRoot': tomllib.loads(pathlib.Path('/etc/containerd/config.toml').read_text()).get('root'),
    'dataMount': json.loads(command(['findmnt', '--json', '--target', '/srv/twenty', '--output', 'SOURCE,TARGET,FSTYPE,SIZE,AVAIL'])),
    'dockerRequiresMountsFor': command(['systemctl', 'show', 'docker.service', '--value', '-p', 'RequiresMountsFor']),
    'containerdRequiresMountsFor': command(['systemctl', 'show', 'containerd.service', '--value', '-p', 'RequiresMountsFor']),
    'currentImage': current_image,
    'currentRevision': pathlib.Path('/srv/twenty/current-revision').read_text().strip(),
    'imageRevision': command(['docker', 'image', 'inspect', current_image, '--format', '{{ index .Config.Labels "org.opencontainers.image.revision" }}']),
    'environmentFileMode': oct(environment_stat.st_mode & 0o777),
    'environmentFileOwnerUid': environment_stat.st_uid,
    'ephemeralRegistryDirectoryCount': len(glob.glob('/run/twenty-demo-registry.*')),
    'durableRootRegistryConfigExists': pathlib.Path('/root/.docker/config.json').exists(),
}
print(json.dumps(result))
'''


def gcloud_json(arguments):
    result = subprocess.run(["gcloud", *arguments, "--project", PROJECT], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    inspection = subprocess.run(
        ["gcloud", "compute", "ssh", PROJECT, "--project", PROJECT, "--zone", ZONE,
         "--tunnel-through-iap", "--quiet", "--command", "sudo python3 -c " + shlex.quote(REMOTE_INSPECTION)],
        capture_output=True, text=True, check=True,
    )
    report = {
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "project": PROJECT,
        "hostname": HOST,
        "host": json.loads(inspection.stdout),
        "instance": gcloud_json(["compute", "instances", "describe", PROJECT, "--zone", ZONE,
                                 "--format=json(name,status,machineType,disks,networkInterfaces)"]),
        "webFirewall": gcloud_json(["compute", "firewall-rules", "describe", PROJECT + "-web",
                                    "--format=json(name,disabled,allowed,sourceRanges,targetTags)"]),
        "baselineSnapshot": gcloud_json(["compute", "snapshots", "describe", arguments.snapshot,
                                         "--format=json(name,status,sourceDisk,diskSizeGb,storageLocations,labels,creationTimestamp)"]),
    }
    with urllib.request.urlopen("https://" + HOST + "/healthz", timeout=30) as response:
        report["publicHealth"] = {"httpStatus": response.status, "body": json.loads(response.read())}
    context = ssl.create_default_context()
    with socket.create_connection((HOST, 443), timeout=30) as connection:
        with context.wrap_socket(connection, server_hostname=HOST) as secured:
            certificate = secured.getpeercert()
            report["tls"] = {"valid": True, "version": secured.version(), "expiresAt": certificate["notAfter"]}
    host = report["host"]
    services = host["services"]
    report["checks"] = {
        "allServicesRunning": all(value["running"] for value in services.values()),
        "databaseAndServerHealthy": all(services[name]["health"] == "healthy" for name in ["postgres", "redis", "server"]),
        "serverWorkerSameImage": services["server"]["image"] == services["worker"]["image"] == host["currentImage"],
        "immutableSourceImage": host["currentImage"].startswith("ghcr.io/materic-inc/twenty-stuard-demo-product@sha256:"),
        "imageRevisionMatchesDeployment": host["imageRevision"] == host["currentRevision"],
        "rateLimitRestored": services["server"]["apiRateLimit"] == services["worker"]["apiRateLimit"] == "100",
        "workerSkipsPreflight": services["worker"]["disableDatabaseMigrations"] == services["worker"]["disableCronRegistration"] == "true",
        "databaseAndRedisPrivate": all(not any(services[name]["ports"].values()) for name in ["postgres", "redis"]),
        "persistentDockerAndContainerd": host["dockerRoot"] == "/srv/twenty/docker" and host["containerdRoot"] == "/srv/twenty/containerd",
        "mountRequiredBeforeDaemons": host["dockerRequiresMountsFor"] == host["containerdRequiresMountsFor"] == "/srv/twenty",
        "environmentPrivate": host["environmentFileMode"] == "0o600" and host["environmentFileOwnerUid"] == 0,
        "registryCredentialsCleaned": host["ephemeralRegistryDirectoryCount"] == 0 and not host["durableRootRegistryConfigExists"],
        "publicHealthOk": report["publicHealth"]["httpStatus"] == 200 and report["publicHealth"]["body"]["status"] == "ok",
        "webIngressEnabled": not report["webFirewall"].get("disabled", False),
        "goldenBaselineReady": report["baselineSnapshot"]["status"] == "READY" and report["baselineSnapshot"].get("labels", {}).get("purpose") == "golden-baseline",
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(report, indent=2) + "\n")
    failed = [name for name, passed in report["checks"].items() if not passed]
    print("Saved nonsecret deployment evidence to " + str(arguments.output))
    if failed:
        raise SystemExit("Failed checks: " + ", ".join(failed))


if __name__ == "__main__":
    main()
