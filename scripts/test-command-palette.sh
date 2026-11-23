#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-test-common.sh
setup_native_test inkflit-commands commands Test.app
printf '%s' '{"notes":[{"id":"first","content":"initial","updated":"1"}],"selected":"first"}' > "$test_dir/notes.json"
for restart in 0 1; do
  INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$test_dir/notes.json" INKFLIT_COMMAND_TEST=1 INKFLIT_COMMAND_HISTORY_RESTART_TEST="$restart" INKFLIT_TEST_UI_LANGUAGE="${INKFLIT_TEST_UI_LANGUAGE:-en}" python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=25)
except subprocess.TimeoutExpired: sys.exit('FAIL: command palette test timed out')
if result.returncode: sys.exit(result.returncode)
PY
done
