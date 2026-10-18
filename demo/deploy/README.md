# Demo hosting

This is an independent Twenty deployment. It has no Stuard integration. Both application processes use the same immutable image. PostgreSQL, Redis and uploads survive application replacement.

## GCP host

Create a dedicated project under the Materic organization and link its existing billing account. `provision-gcp.sh` requires an explicit project ID and checks billing before creating resources; it does not change the default gcloud project or billing configuration.

```sh
GCP_PROJECT_ID=YOUR_SELECTED_PROJECT bash demo/deploy/provision-gcp.sh
```

The default VM is `twenty-stuard-demo-product` in `us-east1-b`, `e2-standard-2` (2 vCPU, 8 GB RAM), with a 20 GB boot disk, separate 50 GB persistent data disk and reserved IPv4 address. Docker data and deployment files live under `/srv/twenty` on the separate disk. A nightly disk snapshot schedule retains seven days and keeps snapshots if the original disk is deleted. Those disk snapshots are crash-consistent; the deployment wrapper also takes a consistent database and uploads backup with application writes stopped before each upgrade.

Web ingress starts disabled to prevent an outsider claiming the first workspace. SSH is limited to Google's Identity-Aware Proxy, accessed with `gcloud compute ssh --tunnel-through-iap`. Use an IAP SSH tunnel to the server's loopback port 3000 to bootstrap the owner. After the owner exists and the synthetic seed is verified, enable the dedicated `twenty-stuard-demo-product-web` firewall rule. The VM has no attached service account, so the application cannot use project-wide cloud credentials. DNS must point the selected hostname to the reserved IPv4 address before HTTPS can complete.

During the private synthetic seed only, `API_RATE_LIMITING_LONG_LIMIT=500` permits 500 requests per minute. Restore `100` and recreate the application processes before enabling public ingress. This changes neither the API key scope nor authentication requirements.

Install the root-owned `twenty-demo-deploy` wrapper at `/usr/local/sbin/twenty-demo-deploy` with mode `755`. Put runtime settings in `/etc/twenty-demo/.env` owned by root with mode `600`; inject the values from Infisical over IAP SSH, never through instance metadata. CI calls:

```sh
sudo /usr/local/sbin/twenty-demo-deploy \
  ghcr.io/materic-inc/twenty-stuard-demo-product@sha256:IMAGE_DIGEST \
  FULL_GIT_COMMIT_SHA \
  GITHUB_ACTOR
```

CI sends its temporary, read-only package token through the SSH connection's standard input. The wrapper logs into the private GHCR package using a root-only temporary Docker configuration under `/run` and removes it on exit. The token is never an argument or a persistent VM credential. Use the pipeline for routine releases; the two-argument wrapper form only works when the image is already available without registry authentication.

The wrapper validates image/revision agreement, fetches only deployment files from that exact Git commit, stops application writes for backup, waits for server health after strict migrations, starts the worker and proxy, and verifies identical server/worker image digests. The current image and source revision are recorded in `/srv/twenty/current-image` and `/srv/twenty/current-revision`. Failed migrations stop deployment; they are not ignored. Backups remain private under `/srv/twenty/backups` and are included in disk snapshots. Monitor disk usage and copy important recovery points off-host before changing retention.

For the initial deployment only, once Docker is ready on the VM:

```sh
python3 demo/deploy/bootstrap-gcp.py
```

This script reads the three scoped secrets from Infisical into a temporary private file, transfers that file over encrypted IAP SSH, installs the root-only environment and deploy wrapper, and starts the pinned official image's server and worker. It does not open public ingress, create the owner, or seed records. The initial hostname is `twenty-stuard-demo-product.materic.inc`.

## Single-host deployment

Use a Linux host with Docker Compose, at least 4 GB RAM and a DNS hostname pointing to it. Only ports 80 and 443 need public ingress. The database and Redis have no published ports. Caddy obtains and renews HTTPS certificates automatically.

Secrets belong to Infisical **Apps**, environment `dev`, path `/twenty-stuard-demo-product` (project `c41f4ae6-3f02-4165-a4a4-3ea9043a6e6c`). `POSTGRES_PASSWORD` must be random hexadecimal so it can be embedded safely in the connection URL. Keep `APP_SECRET` and `ENCRYPTION_KEY` stable across releases. Generate each with `openssl rand -hex 32` and save directly to Infisical without displaying values.

Set non-secret `TWENTY_HOST` and `SERVER_URL` for the actual hostname. Run from the repository root:

```sh
infisical run --projectId c41f4ae6-3f02-4165-a4a4-3ea9043a6e6c \
  --env dev --path /twenty-stuard-demo-product -- \
  docker compose -f demo/deploy/compose.yaml up -d --wait --wait-timeout 900
```

Initial bootstrap uses the stable official `twentycrm/twenty:v2.48.0` image. CI-built fork images override `TWENTY_IMAGE`; the server and worker must always receive the same digest. Bring the server up first so database upgrades finish before the worker starts. Confirm `/healthz`, successful login, record lists and uploads after deployment.

Email uses Twenty's logger driver; synthetic invitations and password recovery messages stay in logs. Do not add real recipients or provider credentials. Bootstrap the initial workspace before opening the deployment to users; signups should not be used to create unsolicited workspaces. Account credentials and API tokens must remain in Infisical.

## Backups and releases

Before changing application versions, create a database and uploads snapshot:

```sh
infisical run --projectId c41f4ae6-3f02-4165-a4a4-3ea9043a6e6c \
  --env dev --path /twenty-stuard-demo-product -- \
  bash demo/deploy/backup.sh /var/backups/twenty
```

Copy backups to separate durable storage and test restoring into an isolated deployment. Database and upload archives are sequential snapshots; stop the worker and prevent writes for a consistent recovery point. Redis jobs are not a substitute for database or upload backups. A code rollback after a database migration can require restoring the matching database snapshot; do not deploy an older image blindly.

## Golden baseline

Only after synthetic import and product QA finish, run `bash demo/deploy/golden-baseline.sh twenty-stuard-demo-baseline-YYYYMMDD`. This stops application writes, creates a checked PostgreSQL dump and matching uploads archive, creates a named manual GCP snapshot while writes remain stopped, then restarts the application. The manual snapshot is separate from the rolling seven-day policy and has no scheduled expiration. Record the snapshot name, image digest and Git revision with the seed manifest.

The backup includes company, person and opportunity counts captured with writes stopped. Prove the database archive is restorable without touching the live database:

```sh
python3 demo/deploy/verify-baseline-restore.py \
  --baseline=twenty-stuard-demo-baseline-YYYYMMDD \
  --output=demo/evidence/baseline-restore-verification.json
```

This creates a uniquely named verification database on the same PostgreSQL instance, restores the archive there, compares its record counts with the saved baseline, and drops only that temporary database. The saved report contains counts and success status.

For recovery, create a separate disk from that snapshot instead of replacing the live disk:

```sh
gcloud compute disks create twenty-stuard-demo-baseline-restore \
  --source-snapshot=YOUR_BASELINE_SNAPSHOT --zone=us-east1-b \
  --project=twenty-stuard-demo-product
```

Attach it to an isolated recovery VM and mount it at a recovery path. Inspect the saved `current-image`, `current-revision` and `backups/` files before starting an isolated Compose stack with the matching image. Inject the original encryption and app secrets from Infisical. The custom database dump restores with `pg_restore` into an empty PostgreSQL16 database; extract the matching uploads archive into its uploads volume. Verify login, record counts, relationships and file access there before any deliberate live reset. Never point a recovery stack at the live database or Redis.
