#!/usr/bin/env bash
set -euo pipefail

repository_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT
mkdir -p "$temporary_directory/bin"

cat > "$temporary_directory/bin/psql" <<'MOCK'
#!/bin/sh
echo psql >> "$DEMO_TEST_LOG"
echo "${DEMO_TEST_SCHEMA_EXISTS:-f}"
MOCK
cat > "$temporary_directory/bin/yarn" <<'MOCK'
#!/bin/sh
echo "yarn $*" >> "$DEMO_TEST_LOG"
if [ "$*" = "${DEMO_TEST_FAIL_COMMAND:-}" ]; then exit 23; fi
MOCK
cat > "$temporary_directory/bin/demo-test-app" <<'MOCK'
#!/bin/sh
echo "app $*" >> "$DEMO_TEST_LOG"
MOCK
chmod +x "$temporary_directory/bin/psql" "$temporary_directory/bin/yarn" "$temporary_directory/bin/demo-test-app"

export DEMO_TEST_LOG="$temporary_directory/calls"
export PATH="$temporary_directory/bin:$PATH"
export PG_DATABASE_URL=postgres://fixture.invalid/twenty
export DISABLE_DB_MIGRATIONS=false DISABLE_CRON_JOBS_REGISTRATION=false
entrypoint="$repository_directory/demo/deploy/entrypoint.sh"

for failed_command in 'database:init:prod' 'command:prod upgrade'; do
  : > "$DEMO_TEST_LOG"
  if DEMO_TEST_FAIL_COMMAND="$failed_command" /bin/sh "$entrypoint" demo-test-app server; then
    echo "Entrypoint accepted failed $failed_command." >&2
    exit 1
  fi
  if grep -Eq '^app|cron:register:all' "$DEMO_TEST_LOG"; then
    echo "Entrypoint continued after failed $failed_command." >&2
    exit 1
  fi
done

: > "$DEMO_TEST_LOG"
/bin/sh "$entrypoint" demo-test-app server
cat > "$temporary_directory/expected-server" <<'EXPECTED'
psql
yarn database:init:prod
yarn command:prod cache:flush
yarn command:prod upgrade
yarn command:prod cache:flush
yarn command:prod cron:register:all
app server
EXPECTED
diff -u "$temporary_directory/expected-server" "$DEMO_TEST_LOG"

: > "$DEMO_TEST_LOG"
DISABLE_DB_MIGRATIONS=true DISABLE_CRON_JOBS_REGISTRATION=true /bin/sh "$entrypoint" demo-test-app worker
printf 'app worker\n' > "$temporary_directory/expected-worker"
diff -u "$temporary_directory/expected-worker" "$DEMO_TEST_LOG"
echo 'Entrypoint fails on migration errors and starts server/worker in the expected order.'
