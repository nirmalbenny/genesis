#!/usr/bin/env bash
# One-time setup of the Cloud KMS key that encrypts stored HighLevel tokens (envelope encryption; see
# functions/src/hl/tokenVault.ts). Enables Cloud KMS, creates key ring "genesis" and key "hl-tokens" in
# us-central1 (rotation is manual), and lets the functions' service account encrypt and decrypt with that key
# only. Safe to re-run. Needs: gcloud signed in as a project owner. Run it before deploying the code that uses it.
#
#   ./scripts/setup-token-encryption.sh [project-id] [service-account-email]
#
# The service account defaults to the one Cloud Functions (2nd gen) use unless configured otherwise:
# <project-number>-compute@developer.gserviceaccount.com.
set -euo pipefail

PROJECT_ID="${1:-genesisaibuilder}"
LOCATION="us-central1"
KEYRING="genesis"
KEY="hl-tokens"

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SA="${2:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"

echo "Enabling the Cloud KMS API"
gcloud services enable cloudkms.googleapis.com --project "$PROJECT_ID"

if ! gcloud kms keyrings describe "$KEYRING" --location "$LOCATION" >/dev/null 2>&1; then
  echo "Creating key ring $KEYRING"
  gcloud kms keyrings create "$KEYRING" --location "$LOCATION"
fi

if ! gcloud kms keys describe "$KEY" --keyring "$KEYRING" --location "$LOCATION" >/dev/null 2>&1; then
  echo "Creating key $KEY (symmetric, software protection level, manual rotation)"
  gcloud kms keys create "$KEY" --keyring "$KEYRING" --location "$LOCATION" --purpose encryption
fi

echo "Letting $SA encrypt and decrypt with $KEY (and nothing else)"
gcloud kms keys add-iam-policy-binding "$KEY" --keyring "$KEYRING" --location "$LOCATION" \
  --member "serviceAccount:${SA}" --role roles/cloudkms.cryptoKeyEncrypterDecrypter >/dev/null

echo "Done: projects/${PROJECT_ID}/locations/${LOCATION}/keyRings/${KEYRING}/cryptoKeys/${KEY}"
echo "To rotate later: gcloud kms keys versions create --key $KEY --keyring $KEYRING --location $LOCATION --primary"
