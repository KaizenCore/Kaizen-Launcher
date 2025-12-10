#!/bin/bash
set -e

# Required environment variables:
# - GITHUB_REPOSITORY: owner/repo
# - GITHUB_TOKEN: Personal Access Token with repo scope
# - RUNNER_NAME: Name for this runner (optional, defaults to hostname)
# - RUNNER_LABELS: Additional labels (optional)

if [ -z "$GITHUB_REPOSITORY" ]; then
    echo "Error: GITHUB_REPOSITORY is required"
    exit 1
fi

if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GITHUB_TOKEN is required"
    exit 1
fi

RUNNER_NAME=${RUNNER_NAME:-$(hostname)}
RUNNER_LABELS=${RUNNER_LABELS:-"docker,linux"}

# Get registration token
echo "Getting registration token..."
REG_TOKEN=$(curl -s -X POST \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runners/registration-token" \
    | grep -o '"token": "[^"]*' | cut -d'"' -f4)

if [ -z "$REG_TOKEN" ]; then
    echo "Error: Failed to get registration token"
    exit 1
fi

# Configure the runner
echo "Configuring runner..."
./config.sh --url "https://github.com/${GITHUB_REPOSITORY}" \
    --token "${REG_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --labels "${RUNNER_LABELS}" \
    --unattended \
    --replace

# Cleanup function
cleanup() {
    echo "Removing runner..."
    ./config.sh remove --token "${REG_TOKEN}" || true
}
trap cleanup EXIT

# Run the runner
echo "Starting runner..."
./run.sh
