#!/usr/bin/env bash
set -euo pipefail

project_id=twenty-stuard-demo-product
repository=materic-inc/twenty-stuard-demo-product
repository_id=1424765924
pool=github-demo
provider=twenty-fork
service_account="github-demo-deploy@$project_id.iam.gserviceaccount.com"

gcloud projects describe "$project_id" --format='value(projectId)' >/dev/null
project_number="$(gcloud projects describe "$project_id" --format='value(projectNumber)')"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com iap.googleapis.com --project="$project_id" --quiet
if ! gcloud iam workload-identity-pools describe "$pool" --project="$project_id" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$pool" --project="$project_id" --location=global --display-name='GitHub Twenty demo deployment'
fi
if ! gcloud iam service-accounts describe "$service_account" --project="$project_id" >/dev/null 2>&1; then
  gcloud iam service-accounts create github-demo-deploy --project="$project_id" --display-name='GitHub Twenty demo deployment'
fi

condition="assertion.repository_id == '$repository_id' && assertion.repository == '$repository' && assertion.ref == 'refs/heads/codex/demo-product'"
mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository=assertion.repository,attribute.ref=assertion.ref'
if gcloud iam workload-identity-pools providers describe "$provider" --workload-identity-pool="$pool" --project="$project_id" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$provider" --workload-identity-pool="$pool" --project="$project_id" --location=global --attribute-mapping="$mapping" --attribute-condition="$condition" --issuer-uri=https://token.actions.githubusercontent.com
else
  gcloud iam workload-identity-pools providers create-oidc "$provider" --workload-identity-pool="$pool" --project="$project_id" --location=global --attribute-mapping="$mapping" --attribute-condition="$condition" --issuer-uri=https://token.actions.githubusercontent.com
fi

gcloud iam service-accounts add-iam-policy-binding "$service_account" \
  --project="$project_id" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$project_number/locations/global/workloadIdentityPools/$pool/attribute.repository_id/$repository_id" --quiet >/dev/null
for role in roles/compute.viewer roles/compute.osAdminLogin roles/iap.tunnelResourceAccessor; do
  gcloud projects add-iam-policy-binding "$project_id" --member="serviceAccount:$service_account" --role="$role" --condition=None --quiet >/dev/null
done

gh api --method PUT "repos/$repository/environments/demo" >/dev/null
gh variable set GCP_PROJECT_ID --repo "$repository" --env demo --body "$project_id"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$repository" --env demo --body "projects/$project_number/locations/global/workloadIdentityPools/$pool/providers/$provider"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo "$repository" --env demo --body "$service_account"
gh variable set GCP_ZONE --repo "$repository" --env demo --body us-east1-b
gh variable set GCP_INSTANCE_NAME --repo "$repository" --env demo --body twenty-stuard-demo-product
echo 'GitHub deployment identity configured. Set DEMO_URL and enable DEMO_AUTO_DEPLOY only after the application and data are ready.'
