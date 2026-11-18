#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-test-common.sh
setup_native_test inkflit-vim-test vimtest InkflitVimTest.app
for restart in 0 1; do
  printf '%s' '{"notes":[{"id":"first","content":"","updated":"1"},{"id":"second","content":"","updated":"2"},{"id":"code","content":":::inkflit code json\n\n:::end","updated":"3"}],"selected":"first"}' > "$test_dir/notes.json"
  INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$test_dir/notes.json" INKFLIT_VIM_TOGGLE_TEST=1 INKFLIT_VIM_RESTART_TEST="$restart" python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try:
    result=subprocess.run([sys.argv[1]],timeout=25)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native Vim toggle test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
done
