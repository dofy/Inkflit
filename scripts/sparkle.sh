#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

version=2.10.1
sha256=1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27
directory="$PWD/build/sparkle-$version"

if [[ ! -f "$directory/Sparkle.framework/Sparkle" ]]; then
  mkdir -p build
  temporary="$(mktemp -d "$PWD/build/.sparkle.XXXXXX")"
  trap 'rm -rf -- "$temporary"' EXIT
  curl --fail --silent --show-error --location --retry 3 \
    "https://github.com/sparkle-project/Sparkle/releases/download/$version/Sparkle-$version.tar.xz" \
    --output "$temporary/Sparkle.tar.xz"
  printf '%s  %s\n' "$sha256" "$temporary/Sparkle.tar.xz" | shasum -a 256 -c - >&2
  mkdir "$temporary/sparkle-$version"
  tar -xf "$temporary/Sparkle.tar.xz" -C "$temporary/sparkle-$version"
  mv -n "$temporary/sparkle-$version" "$PWD/build/"
fi

printf '%s\n' "$directory"
