#!/usr/bin/env bash
# One-time setup of reCAPTCHA Enterprise bot protection for email/password sign-up and sign-in.
# Firebase Auth scores every request itself, so scripts calling the public sign-up API are covered too.
# Upgrades the project to Firebase Authentication with Identity Platform (free up to 50k MAU; cannot be undone),
# enables the reCAPTCHA Enterprise API, grants the Identity Platform service agent its role, and sets the
# enforcement mode. Safe to re-run. Needs: gcloud signed in as a project owner.
#
#   ./scripts/setup-bot-protection.sh [project-id] [AUDIT|ENFORCE|OFF] [min-score]
#
# AUDIT scores requests without blocking; ENFORCE rejects requests without a reCAPTCHA token or scoring at or
# below min-score (0.0-1.0, higher is stricter). The web SDK (firebase >= 9.20) adds the token automatically.
set -euo pipefail

PROJECT_ID="${1:-genesisaibuilder}"
MODE="${2:-ENFORCE}"
MIN_SCORE="${3:-0.3}"
API="https://identitytoolkit.googleapis.com"

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
TOKEN="$(gcloud auth print-access-token)"
call() { curl -sS --fail-with-body -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT_ID" -H "Content-Type: application/json" "$@"; }
subtype() { call "$API/admin/v2/projects/$PROJECT_ID/config" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("subtype", ""))'; }

if [[ "$(subtype)" != "IDENTITY_PLATFORM" ]]; then
  echo "Upgrading to Firebase Authentication with Identity Platform"
  call -X POST "$API/v2/projects/$PROJECT_ID/identityPlatform:initializeAuth" -d '{}' >/dev/null
fi

echo "Enabling the reCAPTCHA Enterprise API"
gcloud services enable recaptchaenterprise.googleapis.com --project "$PROJECT_ID"

echo "Granting the Identity Platform service agent its role"
gcloud beta services identity create --service=identitytoolkit.googleapis.com --project="$PROJECT_ID" >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-identitytoolkit.iam.gserviceaccount.com" \
  --role=roles/identitytoolkit.serviceAgent --condition=None >/dev/null

echo "Setting email/password bot protection: $MODE (block at score <= $MIN_SCORE)"
call -X PATCH "$API/admin/v2/projects/$PROJECT_ID/config?updateMask=recaptchaConfig" -d "{
  \"recaptchaConfig\": {
    \"emailPasswordEnforcementState\": \"$MODE\",
    \"managedRules\": [{ \"endScore\": $MIN_SCORE, \"action\": \"BLOCK\" }]
  }
}" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin).get("recaptchaConfig"), indent=2))'

echo "Done. reCAPTCHA keys can take a few minutes to provision."
