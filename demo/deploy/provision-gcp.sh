#!/usr/bin/env bash
set -euo pipefail

project_id="${GCP_PROJECT_ID:?Set an explicitly selected, billing-enabled GCP project}"
region="${GCP_REGION:-us-east1}"
zone="${GCP_ZONE:-us-east1-b}"
machine_type="${GCP_MACHINE_TYPE:-e2-standard-2}"
resource_name=twenty-stuard-demo-product
deploy_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

gcloud projects describe "$project_id" --format='value(projectId)' >/dev/null
if [[ "$(gcloud billing projects describe "$project_id" --format='value(billingEnabled)')" != True ]]; then
  echo "Billing is not enabled on the selected GCP project." >&2
  exit 1
fi
gcloud services enable compute.googleapis.com --project "$project_id" --quiet

if ! gcloud compute networks describe "$resource_name" --project "$project_id" >/dev/null 2>&1; then
  gcloud compute networks create "$resource_name" --subnet-mode=custom --project "$project_id" --quiet
fi
if ! gcloud compute networks subnets describe "$resource_name" --region "$region" --project "$project_id" >/dev/null 2>&1; then
  gcloud compute networks subnets create "$resource_name" --network "$resource_name" --range=10.84.0.0/24 --region "$region" --project "$project_id" --quiet
fi
if ! gcloud compute firewall-rules describe "$resource_name-web" --project "$project_id" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "$resource_name-web" --network "$resource_name" --allow=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags="$resource_name" --disabled --project "$project_id" --quiet
fi
if ! gcloud compute firewall-rules describe "$resource_name-iap" --project "$project_id" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "$resource_name-iap" --network "$resource_name" --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags="$resource_name" --project "$project_id" --quiet
fi
if ! gcloud compute addresses describe "$resource_name" --region "$region" --project "$project_id" >/dev/null 2>&1; then
  gcloud compute addresses create "$resource_name" --region "$region" --project "$project_id" --quiet
fi
if ! gcloud compute disks describe "$resource_name-data" --zone "$zone" --project "$project_id" >/dev/null 2>&1; then
  gcloud compute disks create "$resource_name-data" --size=50GB --type=pd-balanced --zone "$zone" --labels=application="$resource_name",environment=demo --project "$project_id" --quiet
fi
if ! gcloud compute resource-policies describe "$resource_name-daily" --region "$region" --project "$project_id" >/dev/null 2>&1; then
  gcloud compute resource-policies create snapshot-schedule "$resource_name-daily" --region "$region" --daily-schedule --start-time=04:00 --max-retention-days=7 --on-source-disk-delete=keep-auto-snapshots --project "$project_id" --quiet
fi
attached_policies="$(gcloud compute disks describe "$resource_name-data" --zone "$zone" --project "$project_id" --format='value(resourcePolicies)')"
if [[ "$attached_policies" != *"/$resource_name-daily"* ]]; then
  gcloud compute disks add-resource-policies "$resource_name-data" --resource-policies="$resource_name-daily" --zone "$zone" --project "$project_id" --quiet
fi

if ! gcloud compute instances describe "$resource_name" --zone "$zone" --project "$project_id" >/dev/null 2>&1; then
  gcloud compute instances create "$resource_name" \
    --machine-type="$machine_type" --zone "$zone" --project "$project_id" \
    --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-size=20GB --boot-disk-type=pd-balanced \
    --disk=name="$resource_name-data",device-name=twenty-data,mode=rw,boot=no,auto-delete=no \
    --network-interface=network="$resource_name",subnet="$resource_name",address="$resource_name" \
    --tags="$resource_name" --labels=application="$resource_name",environment=demo \
    --no-service-account --no-scopes --shielded-secure-boot \
    --metadata=block-project-ssh-keys=true,enable-oslogin=TRUE \
    --metadata-from-file=startup-script="$deploy_directory/gcp-startup.sh" --quiet
fi

gcloud compute instances describe "$resource_name" --zone "$zone" --project "$project_id" \
  --format='table(name,status,machineType.basename(),networkInterfaces[0].accessConfigs[0].natIP)'
echo "Wait for startup completion with: gcloud compute instances get-serial-port-output $resource_name --zone $zone --project $project_id"
echo "Then upload this deploy directory and inject Infisical secrets over IAP SSH; never put secrets in VM metadata."
echo "Public web ingress starts DISABLED. Bootstrap the owner over IAP before enabling $resource_name-web."
