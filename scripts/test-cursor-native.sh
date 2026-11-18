#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-test-common.sh
setup_native_test inkflit-cursor-test cursortest InkflitCursorTest.app
for appearance in light dark; do
  printf '%s\n' '{"notes":[{"id":"test","content":"hello","updated":"2026-01-01"}],"selected":"test"}' > "$test_dir/notes.json"
  INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$test_dir/notes.json" INKFLIT_CURSOR_TEST=1 INKFLIT_TEST_APPEARANCE="$appearance" python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess, sys
try:
    result = subprocess.run([sys.argv[1]], timeout=15)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native cursor test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
done
