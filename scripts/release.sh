#!/bin/bash
set -euo pipefail

# Ensure we're in the repository root directory
cd "$(dirname "$0")/.."

echo "🚀 Preparing release..."

# 1. Read current version from package.json
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
BRANCH=$(git branch --show-current)

echo "📦 Target version: ${VERSION} (${TAG}) on branch: ${BRANCH}"

# 2. Safety check: Ensure git working directory is not dirty after type checking
echo "🔍 Running pre-release checks..."
npm run check-types
npm run package

# 3. Check if tag already exists locally or remotely
if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "❌ Error: Tag ${TAG} already exists locally."
  exit 1
fi

if git ls-remote --tags origin "${TAG}" | grep -q "${TAG}"; then
  echo "❌ Error: Tag ${TAG} already exists on remote origin."
  exit 1
fi

# 4. Check if there are changes to commit
if [[ -n $(git status --porcelain) ]]; then
  echo "📝 Staging changes..."
  git add .
  echo "💾 Committing changes as 'Release ${TAG}'..."
  git commit -m "Release ${TAG}"
else
  echo "ℹ️ Working tree is clean. Proceeding with existing commit..."
fi

# 5. Push branch to remote
echo "⬆️ Pushing branch '${BRANCH}' to origin..."
git push origin "${BRANCH}"

# 6. Create annotated tag and push
echo "🏷️ Creating tag '${TAG}'..."
git tag -a "${TAG}" -m "Release ${TAG}"

echo "⬆️ Pushing tag '${TAG}' to origin..."
git push origin "${TAG}"

echo "✅ Successfully pushed ${TAG}! GitHub Actions release workflow has been triggered."
