#!/usr/bin/env bash
set -euo pipefail

snapshot_name="${1:?Pass a permanent baseline snapshot name after import and QA finish}"
[[ "$snapshot_name" =~ ^twenty-demo-baseline-[a-z0-9-]+$ ]] || { echo "Unexpected baseline name." >&2; exit 1; }
[[ ${#snapshot_name} -le 63 ]] || { echo "Baseline name is too long." >&2; exit 1; }
ssh=(gcloud compute ssh twenty-stuard-demo-product --project twenty-stuard-demo-product --zone us-east1-b --tunnel-through-iap --quiet)

resume_script='set -euo pipefail
if [ -s /srv/twenty/current-image ]; then export TWENTY_IMAGE="$(cat /srv/twenty/current-image)"; fi
sudo --preserve-env=TWENTY_IMAGE docker compose --progress quiet --env-file /etc/twenty-demo/.env -f /srv/twenty/deploy/compose.yaml up -d --wait --wait-timeout 900 server
sudo --preserve-env=TWENTY_IMAGE docker compose --progress quiet --env-file /etc/twenty-demo/.env -f /srv/twenty/deploy/compose.yaml up -d --wait --wait-timeout 180 worker proxy'
resume_application() {
  "${ssh[@]}" --command "$resume_script"
}
trap resume_application EXIT

backup_script="$(cat <<'SCRIPT'
set -euo pipefail
if [ -s /srv/twenty/current-image ]; then export TWENTY_IMAGE="$(cat /srv/twenty/current-image)"; fi
compose() { sudo --preserve-env=TWENTY_IMAGE docker compose --progress quiet --env-file /etc/twenty-demo/.env -f /srv/twenty/deploy/compose.yaml "$@"; }
compose stop worker server
sudo install -d -m 700 /srv/twenty/backups/BASELINE_NAME
compose exec -T postgres pg_dump -U twenty -d twenty --format=custom | sudo tee /srv/twenty/backups/BASELINE_NAME/database.dump >/dev/null
compose run --rm --no-deps -T --entrypoint tar server -czf - -C /app/packages/twenty-server/.local-storage . | sudo tee /srv/twenty/backups/BASELINE_NAME/uploads.tar.gz >/dev/null
sudo chmod 600 /srv/twenty/backups/BASELINE_NAME/*
sudo cat /srv/twenty/backups/BASELINE_NAME/database.dump | compose exec -T postgres pg_restore --list >/dev/null
sudo sha256sum /srv/twenty/backups/BASELINE_NAME/database.dump /srv/twenty/backups/BASELINE_NAME/uploads.tar.gz
sync
SCRIPT
)"
backup_script="${backup_script//BASELINE_NAME/$snapshot_name}"
"${ssh[@]}" --command "$backup_script"
gcloud compute snapshots create "$snapshot_name" --project twenty-stuard-demo-product \
  --source-disk=twenty-stuard-demo-product-data --source-disk-zone=us-east1-b \
  --storage-location=us-east1 --labels=application=twenty-stuard-demo-product,purpose=golden-baseline --quiet
echo "Saved permanent snapshot $snapshot_name and matching database/uploads archives."
