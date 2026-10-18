#!/usr/bin/env bash
set -euo pipefail

data_device=/dev/disk/by-id/google-twenty-data
for attempt in {1..30}; do
  [[ -b "$data_device" ]] && break
  sleep 2
done
[[ -b "$data_device" ]] || { echo "Persistent data disk missing." >&2; exit 1; }
if ! blkid "$data_device" >/dev/null 2>&1; then
  mkfs.ext4 -m 0 -L twenty-data "$data_device"
fi
mkdir -p /srv/twenty
data_uuid="$(blkid -s UUID -o value "$data_device")"
if ! grep -q "UUID=$data_uuid " /etc/fstab; then
  echo "UUID=$data_uuid /srv/twenty ext4 defaults,nofail 0 2" >> /etc/fstab
fi
mountpoint -q /srv/twenty || mount /srv/twenty
mkdir -p /srv/twenty/docker /srv/twenty/deploy /srv/twenty/backups
chmod 700 /srv/twenty/backups

if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  architecture="$(dpkg --print-architecture)"
  . /etc/os-release
  echo "deb [arch=$architecture signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl stop docker.service docker.socket
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{"data-root":"/srv/twenty/docker","log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}
JSON
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/twenty-storage.conf <<'UNIT'
[Unit]
RequiresMountsFor=/srv/twenty
UNIT
systemctl daemon-reload
systemctl enable docker.service
systemctl start docker.service
echo "Twenty host ready. Docker data and deployment files persist on the separate twenty-data disk."
