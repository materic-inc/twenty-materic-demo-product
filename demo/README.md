# Twenty Stuard demo product

This fork hosts **Meridian Cloud**, a fictional software company using Twenty as its CRM. It is a separate test product with no Stuard connection.

- Application: https://twenty-stuard-demo-product.materic.inc
- GCP project: `twenty-stuard-demo-product`, under Materic
- Deployment branch: `codex/demo-product`
- Upstream: [`twentyhq/twenty`](https://github.com/twentyhq/twenty), initially pinned to `twenty/v2.48.0`

Use the [data guide](data/README.md) for the synthetic accounts, records, dashboards, repeatable imports and validation. The [hosting guide](deploy/README.md) covers persistent storage, HTTPS, backups and baseline recovery. The [delivery guide](ci/README.md) covers source builds, automatic deployment and daily upstream review branches.

Credentials live in Infisical **Apps**, environment **dev**, path `/twenty-stuard-demo-product`. The owner email is `alex.morgan@meridian-cloud.example`; retrieve `TWENTY_OWNER_PASSWORD` through scoped runtime injection. `DEMO_SMOKE_EMAIL` and `DEMO_SMOKE_PASSWORD` identify a regular staff account used by deployment checks. Never put passwords or API keys in this repository.

The full synthetic profile targets 81 login accounts and 214,000 linked CRM records, plus three dashboards and eleven operational views. Verification reports are saved under `demo/evidence/` after running against the deployed product. All company and staff identities are synthetic. Mail, calendar, payment and AI providers are not connected.

Application updates preserve the database and uploads. The daily upstream workflow proposes changes on `automation/upstream-main`; it does not deploy them automatically. Review database migrations and preserve the matching recovery snapshot before adopting a new upstream version.
