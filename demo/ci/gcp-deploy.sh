#!/usr/bin/env bash
set -euo pipefail

: "${GCP_PROJECT_ID:?Missing GCP_PROJECT_ID}"
: "${GCP_ZONE:?Missing GCP_ZONE}"
: "${GCP_INSTANCE_NAME:?Missing GCP_INSTANCE_NAME}"
: "${DEMO_SOURCE_SHA:?Missing DEMO_SOURCE_SHA}"
image=$(cat demo-image.txt)
if [[ ! "$image" =~ ^ghcr\.io/materic-inc/twenty-stuard-demo-product@sha256:[a-f0-9]{64}$ ]]; then
  echo 'Image must be the fork image pinned by sha256 digest.' >&2
  exit 1
fi
if [[ ! "$DEMO_SOURCE_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Source revision must be a full Git SHA.' >&2
  exit 1
fi

gcloud compute ssh "$GCP_INSTANCE_NAME" \
  --project="$GCP_PROJECT_ID" \
  --zone="$GCP_ZONE" \
  --tunnel-through-iap \
  --quiet \
  --command="sudo /usr/local/sbin/twenty-demo-deploy $image $DEMO_SOURCE_SHA"
