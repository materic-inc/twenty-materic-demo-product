#!/usr/bin/env bash
set -euo pipefail
umask 077

deploy_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
backup_directory="${1:?Pass an absolute backup directory outside the repository}"
[[ "$backup_directory" = /* ]] || { echo "Use an absolute backup path." >&2; exit 1; }
mkdir -p "$backup_directory"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

docker compose -f "$deploy_directory/compose.yaml" exec -T postgres \
  pg_dump -U twenty -d twenty --format=custom \
  > "$backup_directory/twenty-$timestamp.dump"
docker compose -f "$deploy_directory/compose.yaml" exec -T server \
  tar -czf - -C /app/packages/twenty-server/.local-storage . \
  > "$backup_directory/twenty-uploads-$timestamp.tar.gz"
echo "Saved database and uploads backup in $backup_directory."
