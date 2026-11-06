#!/usr/bin/env bash
# One-time setup so GitHub Actions can deploy main to Firebase with Workload Identity Federation (no keys).
# Creates a deploy service account, a workload identity pool + GitHub OIDC provider trusted ONLY for
# <repo> on refs/heads/main, and stores WIF_PROVIDER / DEPLOY_SERVICE_ACCOUNT as GitHub repo variables.
# Safe to re-run. Needs: gcloud (signed in as a project owner) and gh (signed in to the repo owner).
#
#   ./scripts/setup-github-deploy.sh [project-id] [owner/repo]
set -euo pipefail

PROJECT_ID="${1:-genesisaibuilder}"
REPO="${2:-nirmalbenny/genesis}"
POOL="github"
PROVIDER="github"
SA_NAME="github-deployer"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Roles a full `firebase deploy` (rules, indexes, 2nd-gen functions with secrets, hosting) needs.
ROLES=(
  roles/firebase.admin                    # hosting, rules, Firebase project metadata
  roles/cloudfunctions.admin              # create/update functions
  roles/run.admin                         # 2nd-gen functions run on Cloud Run (public invoker policy)
  roles/iam.serviceAccountUser            # deploy functions that run as the compute service account
  roles/secretmanager.viewer              # reference secret versions (cannot read secret values)
  roles/artifactregistry.reader           # check the function image cleanup policy
  roles/datastore.indexAdmin              # Firestore indexes
  roles/serviceusage.serviceUsageConsumer # check that required APIs are enabled
)

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
echo "Project ${PROJECT_ID} (${PROJECT_NUMBER}), repo ${REPO}"

echo "→ Enabling STS and IAM Credentials APIs"
gcloud services enable sts.googleapis.com iamcredentials.googleapis.com

echo "→ Deploy service account ${SA}"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub Actions deployer"
for role in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" --role="$role" \
    --condition=None --quiet >/dev/null
  echo "   granted ${role}"
done

echo "→ Workload identity pool and GitHub provider"
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
       --location=global --workload-identity-pool="$POOL" --display-name="GitHub" \
       --issuer-uri="https://token.actions.githubusercontent.com" \
       --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
       --attribute-condition="assertion.repository=='${REPO}' && assertion.ref=='refs/heads/main'"

echo "→ Allowing ${REPO} to act as the deploy service account"
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" \
  --quiet >/dev/null

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
echo "→ GitHub variables"
gh variable set WIF_PROVIDER --repo "$REPO" --body "$WIF_PROVIDER"
gh variable set DEPLOY_SERVICE_ACCOUNT --repo "$REPO" --body "$SA"

echo
echo "Done. WIF_PROVIDER=${WIF_PROVIDER}"
echo "      DEPLOY_SERVICE_ACCOUNT=${SA}"
echo "Pushes to main now deploy via .github/workflows/deploy.yml"
