#!/usr/bin/env bash
# Validates that the Git tag version (e.g. v0.1.0) matches package.json "version".
# Exits 0 if they match, 1 otherwise. Used by CI to avoid publishing mismatched versions.
set -euo pipefail

TAG_REF="${1:-${GITHUB_REF:?}}"
# Strip refs/tags/ and optional leading 'v'
TAG_VERSION="${TAG_REF#refs/tags/}"
TAG_VERSION="${TAG_VERSION#v}"

PKG_VERSION=$(node -p "require('./package.json').version")

if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
  echo "Version mismatch: tag is '$TAG_VERSION', package.json version is '$PKG_VERSION'"
  exit 1
fi
echo "Version OK: $TAG_VERSION"
