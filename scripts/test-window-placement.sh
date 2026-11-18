#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-test-common.sh
setup_native_test inkflit-placement placement Test.app
printf '%s' '{"notes":[{"id":"first","content":"test","updated":"1"}],"selected":"first"}' > "$test_dir/notes.json"
for restart in 0 1 legacy v2; do
 INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$test_dir/notes.json" INKFLIT_PLACEMENT_TEST=1 INKFLIT_PLACEMENT_RESTART="$restart" python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=25)
except subprocess.TimeoutExpired: sys.exit('FAIL: placement test timed out')
if result.returncode: sys.exit(result.returncode)
PY
done
