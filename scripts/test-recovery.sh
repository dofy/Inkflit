#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-test-common.sh
setup_native_test inkflit-recovery recovery Test.app
python3 - "$test_dir/store" <<'PY'
import base64, json, pathlib, sys
root = pathlib.Path(sys.argv[1]); (root / 'notes').mkdir(parents=True)
def index(updated):
    return json.dumps({'version': 1, 'notes': [{'id': 'test', 'updated': updated}], 'selected': 'test'}).encode()
(root / 'index.json').write_bytes(index('external'))
(root / 'notes/dGVzdA.md').write_text('current external body')
record = root / '.inkflit-save.json'
record.touch(mode=0o600)
record.write_text(json.dumps({'beforeIndex': base64.b64encode(index('1')).decode(),
    'afterIndex': base64.b64encode(index('2')).decode(),
    'bodies': [{'id': 'test', 'before': 'old', 'after': 'new'}], 'deletions': [], 'date': 0}))
PY
for first_launch in 1 0; do
  INKFLIT_ISOLATED_TEST=1 INKFLIT_FILE_STORAGE_TEST=1 INKFLIT_DATA_PATH="$test_dir/store/index.json" INKFLIT_RECOVERY_CONFLICT_TEST=1 INKFLIT_RECOVERY_FIRST_LAUNCH="$first_launch" python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess, sys
try:
    result = subprocess.run([sys.argv[1]], timeout=15)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native recovery test timed out')
sys.exit(result.returncode)
PY
done
