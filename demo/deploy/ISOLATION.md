# Isolated source and browser checks

This is a preparation recipe, not an executed Vercel Sandbox acceptance test. Hosted owner/member access, the source image and baseline restoration are verified separately. No isolated mutation workspace is currently ready.

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

Prepare fresh secrets in a separate Infisical dev path, for example `/twenty-stuard-demo-product-isolated/RUN_ID`. A trusted controller should inject only that run's values; do not give an untrusted source sandbox the hosted demo's Infisical access. Required fresh keys are `APP_SECRET`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `TWENTY_OWNER_PASSWORD` and `TWENTY_DEMO_PASSWORD_SEED`. Generated API and workspace keys must be written back only to the isolated path.

With that isolated environment already injected, the existing portable Compose definition can start the compiled source image and its private dependencies without Caddy:

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

## Account and fixture prerequisite

**Do not run the existing `bootstrap.mjs` or `team.mjs` unchanged in this isolated stack.** `demo/data/secrets.mjs` currently hardcodes Infisical Apps/dev `/twenty-stuard-demo-product`, and `bootstrap.mjs` persists the hosted canonical base URL. Changing only `TWENTY_BASE_URL` or `--state-dir` does not isolate those writes.

Before claiming an executable owner/member fixture recipe, add and test explicit secret-store project/environment/path and target-origin parameters. The isolation mode must reject the hosted secret path, hosted origin and non-loopback database/cache addresses before any account or secret mutation. Give every run a separate private `--state-dir`, owner state, checkpoints, passwords and API key. Persist newly created credentials only to its isolated Infisical scope.

After that prerequisite is implemented and tested, use the existing data guide's order: bootstrap a fresh owner, create regular Member accounts, configure fields/views/dashboards, import the smoke profile and run its verifier. The smoke profile is the minimal linked fixture; expand to the full 214,000-record profile only when needed. The imported workspace ID, owner login and non-admin Member login must all be verified before snapshotting the warm fixture.

Do not substitute a hosted owner/member login or a successful public capture for this isolated acceptance test. Do not restore the hosted database with its existing account credentials as a shortcut. No Stuard registration, sandbox provisioning, paid execution or isolated mutation check was performed as part of this preparation.
