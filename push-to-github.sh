#!/usr/bin/env bash
# Run this script from INSIDE the picoclaw-office/ directory
# after extracting the archive.
#
# Usage:
#   ./push-to-github.sh YOUR_GITHUB_USERNAME [repo-name]
#
# It will:
#   1. Create a new public repo on GitHub via API
#   2. Push all code
#   3. Print the final URL

set -euo pipefail

USERNAME="${1:-}"
REPO="${2:-picoclaw-office}"

if [ -z "$USERNAME" ]; then
  echo "Usage: ./push-to-github.sh YOUR_GITHUB_USERNAME [repo-name]"
  exit 1
fi

echo "→ Creating GitHub repo: $USERNAME/$REPO"
echo ""
echo "You'll need a GitHub Personal Access Token with repo scope."
echo "Get one at: https://github.com/settings/tokens/new"
echo ""
read -rsp "  GitHub token: " TOKEN
echo ""

# Create repo via API
HTTP=$(curl -s -o /tmp/gh-response.json -w "%{http_code}" \
  -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  https://api.github.com/user/repos \
  -d "{\"name\":\"$REPO\",\"description\":\"🦐 PicoClaw Office — 3D AI agent workspace powered by PicoClaw + Claude\",\"public\":true}")

if [ "$HTTP" = "201" ]; then
  echo "✓ Repo created: https://github.com/$USERNAME/$REPO"
elif [ "$HTTP" = "422" ]; then
  echo "⚠ Repo already exists, pushing to existing repo"
else
  echo "✗ Failed to create repo (HTTP $HTTP)"
  cat /tmp/gh-response.json
  exit 1
fi

# Configure remote and push
git remote remove origin 2>/dev/null || true
git remote add origin "https://$USERNAME:$TOKEN@github.com/$USERNAME/$REPO.git"
git branch -M main
git push -u origin main

echo ""
echo "✅ Pushed! Your repo: https://github.com/$USERNAME/$REPO"
echo ""
echo "  Next steps:"
echo "    git clone https://github.com/$USERNAME/$REPO"
echo "    cd $REPO"
echo "    export ANTHROPIC_API_KEY=sk-ant-..."
echo "    ./launch.sh"
