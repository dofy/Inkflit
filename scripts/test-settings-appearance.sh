#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-test-common.sh
setup_native_test inkflit-settings-test settings Test.app
for appearance in light dark; do
 printf '%s' '{"notes":[{"id":"test","content":":::inkflit code json\n{\"name\":\"Inkflit\"}\n:::end","updated":"1"}],"selected":"test"}' > "$test_dir/notes.json"
 INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$test_dir/notes.json" INKFLIT_SETTINGS_ACCENT_TEST=1 INKFLIT_TEST_APPEARANCE="$appearance" INKFLIT_SETTINGS_CAPTURE="$test_dir/settings-$appearance.png" python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=20)
except subprocess.TimeoutExpired: sys.exit('FAIL: settings test timed out')
if result.returncode: sys.exit(result.returncode)
PY
done
