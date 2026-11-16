#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d "${TMPDIR%/}/inkflit-storage-test.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
swiftc Sources/Localization.swift Sources/NoteStorage.swift Sources/Onboarding.swift tests/storage.swift -o "$test_dir/storage-tests"
"$test_dir/storage-tests"
