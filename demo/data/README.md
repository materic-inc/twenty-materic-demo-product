# Meridian Cloud demo workspace

An established fictional B2B software company using Twenty as its CRM. All companies, identities, telephone numbers, domains, sales conversations and financial amounts are synthetic. `.example` domains are reserved and cannot deliver real customer mail. No mailbox, calendar, AI provider, payment account or Materic connection is created.

## Dataset

| Record                             |         Full profile |
| ---------------------------------- | -------------------: |
| Login accounts / workspace members | 80 + workspace owner |
| Companies                          |                5,000 |
| Contacts                           |               25,000 |
| Opportunities                      |                8,000 |
| Tasks                              |               24,000 |
| Notes                              |               20,000 |
| Task links                         |               72,000 |
| Note links                         |               60,000 |

Companies span 20 industries, 16 cities, three sales regions, three customer tiers and six currencies. Histories cover April 2025 through October 2026. Deals have named contacts at the correct company, account owners, annual amounts, close dates and all five native pipeline stages. Notes describe seat counts, budgets, evaluation criteria, procurement blockers and next steps. Tasks include completed history, overdue work and future follow-ups. Every task and note links separately to its company, contact and opportunity, matching Twenty's polymorphic relationship model.

Configure adds six company fields, a contact City field, three native dashboards with twenty live chart widgets, and eleven shared operational views covering enterprise accounts, accounts needing attention, regional portfolios, pipeline, proposals, contracts, follow-ups, work in progress, completed activities and account conversations. Dashboard charts query persisted CRM data: pipeline stages, monthly opportunity growth, company regions and industries, account health, task completion and conversation history. Financial amounts in different currencies are never combined into a misleading total. Upstream Twenty remains unchanged.

The full dataset contains 214,000 persisted records, excluding staff, three dashboards and server-generated timeline events. The smoke profile uses 12 companies, 60 contacts, 24 opportunities, 72 tasks and 60 notes. Smoke is an exact subset of the full fixture: each shared ID retains its relationships, timestamps and immutable author when expanding to full. Fifteen percent of accounts are recent inbound prospects from the last two weeks, with fresh early-stage deals.

## Run

Requires Node.js 22+ without npm dependencies. Bootstrap also requires the authenticated Infisical CLI. First deploy Twenty. `bootstrap.mjs` creates the owner and workspace through the normal auth APIs, activates the standard application, completes owner profile and email-sync onboarding, and creates an Admin-scoped seed API key. It signs in to the existing owner/workspace when rerun. Disable external email delivery and keep `IS_EMAIL_VERIFICATION_REQUIRED=false` for reserved demo identities. Provision these values in Infisical **dev**, under `/twenty-materic-demo-product`, and inject them at runtime:

- `TWENTY_BASE_URL`: deployed Twenty origin.
- `TWENTY_OWNER_PASSWORD`: owner password stored in Infisical before bootstrap. Owner email defaults to `alex.morgan@meridian-cloud.example`; `TWENTY_OWNER_EMAIL` can override it.
- `TWENTY_API_KEY`: API key with object data, data-model, view and workspace-member administration permissions.
- `TWENTY_WORKSPACE_ID`: pins mutations to the intended demo workspace.
- `TWENTY_DEMO_PASSWORD_SEED`: long random secret, stored in Infisical before provisioning accounts. Individual staff passwords derive from this seed and their email address.

Preview and validate without credentials or network calls:

```sh
node demo/data/seed.mjs --profile full
node --test demo/data/dataset.test.mjs
```

Bootstrap with `TWENTY_BASE_URL` and `TWENTY_OWNER_PASSWORD` injected. The script immediately stores `TWENTY_API_KEY`, `TWENTY_WORKSPACE_ID` and the canonical public `TWENTY_BASE_URL` in the pinned Infisical Apps dev path. CLI output is captured, and its temporary owner-only dotenv file is deleted afterward. The private `bootstrap-secrets.json` file retains recovery data; do not print its contents. For an IAP/SSH loopback tunnel, set `TWENTY_AUTH_ORIGIN` to Twenty's configured public origin while `TWENTY_BASE_URL` points at the tunnel.

```sh
node demo/data/bootstrap.mjs
```

With the complete scoped Infisical environment injected:

```sh
node demo/data/team.mjs --owner-state ~/.local/share/twenty-materic-demo-product/bootstrap-private/bootstrap-secrets.json
node demo/data/configure.mjs
node demo/data/cleanup-upstream-samples.mjs --apply --report demo/evidence/upstream-sample-cleanup.json
node demo/data/seed.mjs --profile smoke --apply
node demo/data/verify.mjs --profile smoke --samples 4
node demo/data/seed.mjs --profile full --apply
node demo/data/verify.mjs --profile full --report demo/evidence/data-verification-full.json
```

`team.mjs` creates real login accounts through Twenty's signup API, completes profile and email-sync onboarding, and preserves a private credential directory. It temporarily enables a random workspace invitation link, then restores the original invitation state in `finally`. It records invitation state privately before enabling the link and recovers it on the next run after a process crash. Existing staff accounts sign in with their recorded password before resuming incomplete onboarding. Members use the workspace's default role; the owner retains administration. It never prints passwords, invitation hashes or tokens.

Invitation administration requires a user-bound owner session in Twenty v2.48, supplied with `--owner-state`. If that ephemeral session expires, rerun bootstrap with the same private state directory, then rerun team provisioning; recorded invitation state and completed accounts are recovered. Team provisioning verifies the smoke account's non-admin Member role before storing `DEMO_SMOKE_EMAIL` and `DEMO_SMOKE_PASSWORD` in the scoped Infisical dev path. `audit-team.mjs --owner-state /private/bootstrap-secrets.json` independently verifies all 80 staff have Member access and only the owner is Admin.

The default private state directory is `~/.local/share/twenty-materic-demo-product`, created with owner-only permissions. Keep it outside Git. Use `--state-dir /absolute/private/path` to choose another destination. Staff passwords remain reproducible from the Infisical seed; retain the original seed rather than rotating it casually.

For private imports before opening ingress, keep `TWENTY_BASE_URL` set to the canonical public origin and set `TWENTY_TRANSPORT_URL=http://127.0.0.1:13007` for the IAP tunnel. Requests use the tunnel while checkpoints, credentials and authentication remain pinned to the canonical product. Remove the transport override for subsequent public verification.

`seed.mjs` uses `/rest/batch/{object}?upsert=true` in dependency order. It checks workspace identity from the credential and stops if expected fields or members are missing. Company and opportunity owners cycle through seeded staff. `TWENTY_MEMBER_IDS` can override owner IDs as a comma-separated list.

Created-by attribution uses the actual workspace-member ID and profile name of the company owner. Twenty's native API preserves these explicit fictional historical authors on insertion. Updated-by remains the real API principal. The import never changes audit attribution through direct database writes.

`cleanup-upstream-samples.mjs` removes only the 17 known upstream sample business records: five real-company examples, five founder contacts, six opportunities and the initial sample dashboard. It derives an ID allowlist from the pinned upstream prefill sources and requires each candidate's actor to be SYSTEM. Other records, all 81 users and native workflow templates are preserved. Without `--apply`, it only previews the allowlisted candidates.

Successful batches are fingerprinted in a private checkpoint. Rerunning resumes after a failure without duplicating records. After restoring a database snapshot, use `--skip-checkpoint` or clear that target's local checkpoint so missing records are replayed. Never reuse checkpoints between workspace IDs.

Batch size defaults to 100. A 700 ms delay respects Twenty's default 100 requests/minute limit. Full import takes at least 25 minutes plus server time. For a dedicated demo server with an explicitly increased `API_RATE_LIMITING_LONG_LIMIT`, `--delay-ms 150` accelerates it. Retries back off on throttling and server errors. Use the default pacing if sharing the server with interactive users.

`--as-of 2026-10-18T16:00:00.000Z` pins the temporal snapshot. Keep it fixed for replayable comparisons; change it deliberately when generating a newer baseline. `--from-kind opportunities` skips preceding objects during recovery and assumes those dependencies already exist.

## Validation and recovery

`dataset.test.mjs` checks deterministic identities, full-scale uniqueness and breadth, coherent company/contact/deal relationships, three independent activity targets, reserved email domains, chronological history, financial currencies, overdue and upcoming work.

`verify.mjs` independently reads persisted counts and samples complete company → contact → opportunity → task/note chains from the deployed API, and asserts exact historic creation/update timestamps against the pinned dataset snapshot. Follow this with browser checks: log in, switch company views, search a seeded company, open its contacts and opportunities, review its notes/tasks, use pipeline columns, and log in as a seeded team member.

This tooling has no destructive reset command. For repeatable runs, snapshot the PostgreSQL database and stored files after a successful import. Restore that snapshot before replaying application updates. Do not import into a real customer workspace.
