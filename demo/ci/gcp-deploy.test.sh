#!/usr/bin/env bash
set -euo pipefail

repository_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT
mkdir -p "$temporary_directory/bin"
cat > "$temporary_directory/bin/gcloud" <<'MOCK'
#!/bin/sh
printf '%s\n' "$@" > "$DEMO_TEST_ARGUMENTS"
cat > "$DEMO_TEST_INPUT"
MOCK
chmod +x "$temporary_directory/bin/gcloud"
export PATH="$temporary_directory/bin:$PATH"
export DEMO_TEST_ARGUMENTS="$temporary_directory/arguments"
export DEMO_TEST_INPUT="$temporary_directory/input"
export GCP_PROJECT_ID=fixture-project GCP_ZONE=us-east1-b GCP_INSTANCE_NAME=fixture-instance
export DEMO_SOURCE_SHA=0123456789012345678901234567890123456789
export GHCR_USERNAME=fixture-bot GHCR_TOKEN=fixture-ci-token-not-a-secret
printf '%s\n' 'ghcr.io/materic-inc/twenty-stuard-demo-product@sha256:0123456789012345678901234567890123456789012345678901234567890123' > "$temporary_directory/demo-image.txt"

cd "$temporary_directory"
bash "$repository_directory/demo/ci/gcp-deploy.sh" > output 2>&1
printf '%s\n' "$GHCR_TOKEN" > expected-input
diff -u expected-input "$DEMO_TEST_INPUT"
if grep -q "$GHCR_TOKEN" "$DEMO_TEST_ARGUMENTS" output; then
  echo 'Registry token escaped into arguments or output.' >&2
  exit 1
fi
grep -qx -- '--tunnel-through-iap' "$DEMO_TEST_ARGUMENTS"
grep -qx -- '--ssh-flag=-T' "$DEMO_TEST_ARGUMENTS"
grep -q '^--command=sudo /usr/local/sbin/twenty-demo-deploy ghcr.io/materic-inc/twenty-stuard-demo-product@sha256:' "$DEMO_TEST_ARGUMENTS"

rm "$DEMO_TEST_ARGUMENTS"
if GHCR_USERNAME="invalid;username" bash "$repository_directory/demo/ci/gcp-deploy.sh" > output 2>&1; then
  echo 'Unsafe SSH command username accepted.' >&2
  exit 1
fi
[[ ! -e "$DEMO_TEST_ARGUMENTS" ]] || { echo 'Invalid input reached gcloud.' >&2; exit 1; }
echo 'Deployment sends registry credentials through standard input only and validates SSH command input.'
