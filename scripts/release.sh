#!/bin/bash
set -euo pipefail

# Ensure we're in the repository root directory
cd "$(dirname "$0")/.."

echo "🚀 Preparing release..."

# 1. Read current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

NEXT_PATCH="${MAJOR}.${MINOR}.$((PATCH + 1))"
NEXT_MINOR="${MAJOR}.$((MINOR + 1)).0"
NEXT_MAJOR="$((MAJOR + 1)).0.0"

echo ""
echo "Current version in package.json: ${CURRENT_VERSION}"
echo "Choose release version:"
echo "  1) Minor bump: ${NEXT_MINOR} (Recommended for new features)"
echo "  2) Patch bump: ${NEXT_PATCH} (Bugfixes / small patches)"
echo "  3) Major bump: ${NEXT_MAJOR} (Breaking changes)"
echo "  4) Custom version"
echo ""

# Read from controlling terminal (/dev/tty) so it works interactively
if [ -t 0 ]; then
  read -r -p "Enter choice [1-4] (default 1): " CHOICE
else
  read -r -p "Enter choice [1-4] (default 1): " CHOICE </dev/tty || CHOICE="1"
fi

case "${CHOICE:-1}" in
  1)
    NEW_VERSION="${NEXT_MINOR}"
    ;;
  2)
    NEW_VERSION="${NEXT_PATCH}"
    ;;
  3)
    NEW_VERSION="${NEXT_MAJOR}"
    ;;
  4)
    if [ -t 0 ]; then
      read -r -p "Enter custom version (e.g. 1.5.0): " NEW_VERSION
    else
      read -r -p "Enter custom version (e.g. 1.5.0): " NEW_VERSION </dev/tty
    fi
    ;;
  *)
    echo "Invalid option. Aborting."
    exit 1
    ;;
esac

if [[ -z "${NEW_VERSION:-}" ]]; then
  echo "❌ Error: Version cannot be empty."
  exit 1
fi

TAG="v${NEW_VERSION}"
BRANCH=$(git branch --show-current)

echo ""
echo "📦 Selected version: ${NEW_VERSION} (${TAG}) on branch: ${BRANCH}"

# 2. Check if tag already exists locally or remotely
if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "❌ Error: Tag ${TAG} already exists locally."
  exit 1
fi

if git ls-remote --tags origin "${TAG}" | grep -q "${TAG}"; then
  echo "❌ Error: Tag ${TAG} already exists on remote origin."
  exit 1
fi

# 3. Update version in package.json
echo "📝 Updating package.json to ${NEW_VERSION}..."
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  pkg.version = '${NEW_VERSION}';
  fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# 4. Update CHANGELOG.md if it contains [Unreleased]
TODAY=$(date +"%Y-%m-%d")
if grep -q "## \[Unreleased\]" CHANGELOG.md; then
  echo "📝 Updating CHANGELOG.md from [Unreleased] to [${NEW_VERSION}] - ${TODAY}..."
  node -e "
    const fs = require('fs');
    let changelog = fs.readFileSync('./CHANGELOG.md', 'utf8');
    changelog = changelog.replace('## [Unreleased]', '## [${NEW_VERSION}] - ${TODAY}');
    fs.writeFileSync('./CHANGELOG.md', changelog);
  "
fi

# 5. Safety check: Run type checks and build package
echo "🔍 Running pre-release checks..."
npm run check-types
npm run package

# 6. Commit changes
if [[ -n $(git status --porcelain) ]]; then
  echo "📝 Staging changes..."
  git add .
  echo "💾 Committing changes as 'Release ${TAG}'..."
  git commit -m "Release ${TAG}"
else
  echo "ℹ️ Working tree is clean. Proceeding with existing commit..."
fi

# 7. Push branch to remote
echo "⬆️ Pushing branch '${BRANCH}' to origin..."
git push origin "${BRANCH}"

# 8. Create annotated tag and push
echo "🏷️ Creating tag '${TAG}'..."
git tag -a "${TAG}" -m "Release ${TAG}"

echo "⬆️ Pushing tag '${TAG}' to origin..."
git push origin "${TAG}"

echo ""
echo "✅ Successfully released and pushed ${TAG}!"
echo "🚀 GitHub Actions release workflow has been triggered."
