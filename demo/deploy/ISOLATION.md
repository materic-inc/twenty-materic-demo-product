# Isolated source and browser checks

The isolated seed entry point has local mocked and dry-run tests. An actual isolated stack, source mutation and Vercel Sandbox acceptance have not been run. Hosted owner/member access, the source image and baseline restoration are verified separately.

## Resources and source

Use a private Linux sandbox with Docker Engine and Compose, Node 24 (Docker builds use 24.19.0; `.nvmrc` selects 24.16.0), and Yarn 4.13.0. The hosted compiled application is verified on 2 vCPU / 8 GB RAM. For a Vercel Sandbox, 4 vCPU supplies 8 GB RAM; start source-build evaluation with 8 vCPU / 16 GB, then measure. The source-build memory requirement has not been benchmarked here. Use a private filesystem with room for the checkout, dependencies, Docker layers, PostgreSQL and uploads.

Vercel supports running Docker inside a sandbox. Its network proxy CA must also be trusted inside build/runtime containers when the proxy intercepts their HTTPS requests; do not disable certificate verification. See [Vercel's Docker guidance](https://vercel.com/kb/guide/docker).

Pin application source to `d98f3b43239b06dd440adb4d0d3d1800a2b2b54b` for the initial comparison. Install dependencies and build a warm image before allowing untrusted changes. A prewarmed snapshot saves files, not running processes: restart Docker, PostgreSQL, Redis and the application after every resume.

The source build uses the same assembled Dockerfile and target as the verified CI build:

```sh
mkdir -p .isolated
cat packages/twenty-docker/twenty/Dockerfile demo/ci/Dockerfile.append > .isolated/Dockerfile
export GITHUB_SHA="$(git rev-parse HEAD)"
app_version="$(node demo/ci/image-version.mjs)"
docker build --platform linux/amd64 --target stuard-demo \
  --build-arg APP_VERSION="$app_version" \
  --file .isolated/Dockerfile --tag twenty-stuard-isolated:current .
```

Rebuild from the exact changed checkout for a source mutation check. Testing only the hosted or cached image does not test local source changes.

## Separate services and configuration

Each run needs its own Compose project name, PostgreSQL 16 database, Redis 7.4 instance, uploads volume, application secrets and private bootstrap state directory. Never mount the GCP deployment's volumes, load its dotenv file, reuse its account credentials, or configure its PostgreSQL/Redis URLs.

Prepare fresh secrets in a separate Infisical dev path, for example `/twenty-stuard-demo-product-isolated/run-20261018-a`. A trusted controller should inject only that run's values; do not give an untrusted source sandbox the hosted demo's Infisical access. Required fresh keys are `APP_SECRET`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `TWENTY_OWNER_PASSWORD` and `TWENTY_DEMO_PASSWORD_SEED`. Generated API and workspace keys must be written back only to the isolated path. Run the seed tooling from a trusted checkout; the untrusted application must not inherit the controller's Infisical credentials or private seed state.

The existing Compose definition can start the compiled source image and its private dependencies without Caddy. **It is not compatible with the strict seed gate as written:** its server connects to Docker DNS names `postgres` and `redis`, which the seed gate rejects. The following commands are an infrastructure reference, not a seed-ready stack:

```sh
export TWENTY_IMAGE=twenty-stuard-isolated:current
export SERVER_URL=http://127.0.0.1:3000
export TWENTY_BASE_URL=http://127.0.0.1:3000
export TWENTY_AUTH_ORIGIN=http://127.0.0.1:3000
export TWENTY_HOST=localhost
export API_RATE_LIMITING_LONG_LIMIT=100
unset TWENTY_TRANSPORT_URL

docker compose --project-name "twenty-stuard-isolated-${RUN_ID:?Set a unique run ID}" \
  -f demo/deploy/compose.yaml up -d --wait --wait-timeout 900 server
docker compose --project-name "twenty-stuard-isolated-${RUN_ID}" \
  -f demo/deploy/compose.yaml up -d --wait --wait-timeout 180 worker
curl --fail http://127.0.0.1:3000/healthz
```

The server binds to loopback, and PostgreSQL/Redis have no published ports. A localhost-only browser runner must execute inside the same sandbox/network context to reach this address. Forwarding a Sandbox public URL is a different browser access model and is not verified by this recipe.

## Isolated owner and smoke fixture

**Before applying, independently verify the running server's actual database/cache configuration. The CLI validates declarations; it cannot attest what services an already-running HTTP server uses. A loopback tunnel to the hosted app is not an isolated server.** A suitable deployment runs Twenty, a fresh PostgreSQL database and a fresh Redis instance on the same private host/VM using literal loopback addresses. Stack creation and this verification remain prerequisites; do not relabel the existing Compose DNS endpoints as loopback to pass the gate.

Use `demo/data/isolated-seed.mjs`, not direct hosted bootstrap commands. It requires every scope argument explicitly, accepts only Infisical `dev` and `/twenty-stuard-demo-product-isolated/<run-id>`, and pins requests to one literal `127.0.0.1` or `[::1]` origin and port. It rejects hosted or hostname targets, transport overrides, redirects, non-loopback DB/cache endpoints, and conflicting injected URLs before any account or secret mutation. Normal hosted scripts retain their existing defaults when explicit isolation mode is absent.

Preview without credentials, network calls, state creation or Infisical access. Substitute the approved Infisical project UUID and a unique lowercase run ID. Endpoint arguments must omit passwords; do not put secrets in command arguments. Use a real absolute state path outside Git and outside hosted state, with no symlink ancestors.

```sh
node demo/data/isolated-seed.mjs \
  --project-id APPROVED_PROJECT_UUID \
  --environment dev \
  --secret-path /twenty-stuard-demo-product-isolated/run-20261018-a \
  --target-origin http://127.0.0.1:3000 \
  --database-url postgres://127.0.0.1:5432/twenty \
  --cache-url redis://127.0.0.1:6379 \
  --state-dir /absolute/private/twenty-isolated/run-20261018-a
```

For a real run, first have the trusted operator provision fresh owner/password-seed values in that exact scope. The owner password must contain 8..50 characters and the password seed at least 32 characters. Do not copy the hosted values. With the server prerequisites verified, the following explicit command permits local account/data writes and scoped Infisical writes:

```sh
infisical run --projectId APPROVED_PROJECT_UUID --env dev \
  --path /twenty-stuard-demo-product-isolated/run-20261018-a -- \
  node demo/data/isolated-seed.mjs \
    --project-id APPROVED_PROJECT_UUID \
    --environment dev \
    --secret-path /twenty-stuard-demo-product-isolated/run-20261018-a \
    --target-origin http://127.0.0.1:3000 \
    --database-url postgres://127.0.0.1:5432/twenty \
    --cache-url redis://127.0.0.1:6379 \
    --state-dir /absolute/private/twenty-isolated/run-20261018-a \
    --apply
```

Unset `TWENTY_TRANSPORT_URL` completely. If `TWENTY_BASE_URL`, `TWENTY_AUTH_ORIGIN` or `SERVER_URL` is injected, it must equal the target origin. Injected `PG_DATABASE_URL` and `REDIS_URL` must match the declared local endpoints; database authentication is omitted from private manifests and printed plans. The runner does not use inherited API keys, workspace IDs or owner sessions. Bootstrap creates or recovers the credentials in this run's private state and persists the exact local origin to the specified isolated scope.

The sequence creates the owner and two regular Members, then audits their roles and a Member password login. Even on reruns with completed accounts, that audit checks the owner and Member sessions' actual workspace IDs and identities against private saved state before configuration or seeding can continue. It then configures fields/views/dashboards, removes only the existing allowlisted upstream samples, imports the smoke profile, and independently verifies its counts and relationships. It never selects the full 214,000-record import. Successful command exit and the private verification report are required before snapshotting; local mocks are not proof that a real application accepted these operations.

State directories are owner-only (`0700`), with private files (`0600`). `isolation.json` binds the secret project/path, target origin and service endpoints. An unmarked nonempty directory, different scope, public file or symlink is rejected. Exact reruns reuse the existing run and seed checkpoints. A `seed.lock` prevents simultaneous orchestration; after a crash, confirm no seed process remains before removing only that run's lock. Preserve the owner/team/invitation state for recovery. A different run needs a new secret path, fresh services and a fresh state directory. Never print the credential files.

Local verification (fake credentials, mocked API/subprocesses; no real secrets or services):

```sh
node --test demo/data/isolation.test.mjs demo/data/dataset.test.mjs
```

Do not substitute a hosted owner/member login or public capture for isolated acceptance. Do not restore hosted database accounts as a shortcut. This change creates no cloud resources, Stuard runtime integration, warm snapshot or paid execution. Source-build memory, expanded archive size, restart behavior and a complete isolated browser/mutation loop still need separate verification.
