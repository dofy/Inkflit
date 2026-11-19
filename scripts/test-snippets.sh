#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-test-common.sh
setup_native_test inkflit-snippets snippets Test.app
printf '%s' '{"notes":[{"id":"first","content":"","updated":"1"},{"id":"math","content":"math\n","updated":"1"}],"selected":"first"}' > "$test_dir/notes.json"
INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$test_dir/notes.json" INKFLIT_SNIPPETS_TEST=1 INKFLIT_SETTINGS_CAPTURE_DIR="${INKFLIT_SETTINGS_CAPTURE_DIR:-}" INKFLIT_TEST_UI_LANGUAGE="${INKFLIT_TEST_UI_LANGUAGE:-en}" python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=30)
except subprocess.TimeoutExpired: sys.exit('FAIL: snippets test timed out')
if result.returncode: sys.exit(result.returncode)
PY
