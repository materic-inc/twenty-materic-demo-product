# Demo delivery

The `codex/demo-product` branch is the deployed product. The repository remains a GitHub fork of `twentyhq/twenty`; `main` retains upstream history. Set the GitHub default branch to `codex/demo-product` so its daily upstream proposal schedule runs.

## Build and release

`demo-ci.yml` checks the demo scripts and Compose configuration, then builds the actual frontend/backend from the checked-out fork using Twenty's Dockerfile. The small appended target installs the strict migration entrypoint. Successful branch builds publish `ghcr.io/materic-inc/twenty-stuard-demo-product:sha-<commit>`; the `demo-image` artifact contains its immutable digest. PR builds never publish or deploy. Make the GHCR package public once after its first publication so the VM can pull it without registry credentials.

Inherited upstream workflows are disabled in this fork's GitHub Actions settings, preserving their source files for future merges. Enable the two `demo-*` workflows. Upstream's full monorepo CI targets organizational runners, release registries, and integration secrets; this fork instead compiles the complete application image and runs focused deployment checks. It does not claim to run the entire upstream test suite.

## GCP delivery

The image builds without hosting credentials. Deployment remains off until a host exists and repository variable `DEMO_AUTO_DEPLOY` is `true`.

Configure the GitHub `demo` environment:

| Name | Kind | Meaning |
| --- | --- | --- |
| `GCP_PROJECT_ID` | Variable | Dedicated GCP project |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Variable | Full Workload Identity Provider resource name |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | Variable | Deployment service account email |
| `GCP_ZONE` | Variable | VM zone |
| `GCP_INSTANCE_NAME` | Variable | VM name |
| `DEMO_URL` | Variable | Public HTTPS application URL |
| `DEMO_SMOKE_EMAIL` | Secret | Optional seeded test user email |
| `DEMO_SMOKE_PASSWORD` | Secret | Seeded test user password; set together with email |

Set `DEMO_AUTO_DEPLOY` at repository level because it gates the job before GitHub loads environment-scoped variables. GitHub obtains short-lived GCP credentials through Workload Identity Federation, restricted to this fork and its deployment branch. No service account key is stored in GitHub. `gcloud compute ssh --tunnel-through-iap` reaches the VM through Google's authenticated tunnel; SSH is not open to the Internet.

The VM's root-owned `twenty-demo-deploy` wrapper receives the exact GHCR digest and source revision. Its deployment must stop the worker during migrations, back up existing data, fail on migration errors, start the server before the worker, and verify both use the same image. The workflow then checks backend health and renders sign-in in Chromium. With smoke credentials, it also signs in and verifies the Companies and People navigation. Browser evidence is saved as an artifact. Failed deployment commands, failed login, and browser exceptions fail the workflow.

The built-in `/healthz` endpoint is a liveness check, not a full database/Redis check. Authenticated smoke credentials are needed to exercise a real workspace after deployment. Database migrations are not automatically rolled back: preserve the pre-upgrade backup and follow Twenty's upgrade requirements.

## Moving upstream

`demo-upstream-sync.yml` fetches Twenty's `main` every day at 10:17 UTC and refreshes `automation/upstream-main` with a merge into the current demo branch. It runs a validation-only image build and puts a compare/create-PR link in the Actions summary. Materic's organization policy prevents Actions from creating pull requests, so a human creates or updates the review PR using that link. A PR already open from that branch receives the new commits automatically. No personal access token or organization policy change is needed.

The workflow never merges into deployment automatically and never resets or seeds the database. Conflicts fail visibly instead of replacing demo changes. Review migrations before merging. To stage smaller or historical batches, open additional reviewed branches from selected upstream commits. The explicitly dispatched proposal build cannot publish images or access deployment secrets.

Run locally:

```sh
bash -n demo/ci/gcp-deploy.sh demo/ci/upstream-sync.sh
node --check demo/ci/browser-smoke.mjs
```
