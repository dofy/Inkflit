#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-test-common.sh
setup_native_test inkflit-toolbar-drag toolbar Test.app
printf '%s' '{"notes":[{"id":"first","content":"first","updated":"1"},{"id":"second","content":"second","updated":"2"}],"selected":"first"}' > "$test_dir/notes.json"
for mode in regions real cursor; do
 INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$test_dir/notes.json" INKFLIT_HEADER_DRAG_TEST="$([[ "$mode" == regions ]] && echo 1 || echo 0)" INKFLIT_REAL_DRAG_TEST="$([[ "$mode" == real ]] && echo 1 || echo 0)" INKFLIT_TOOLBAR_CURSOR_TEST="$([[ "$mode" == cursor ]] && echo 1 || echo 0)" python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=20)
except subprocess.TimeoutExpired: sys.exit('FAIL: toolbar test timed out')
if result.returncode: sys.exit(result.returncode)
PY
done
