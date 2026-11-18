#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -gt 1 || "${1:-}" == --* ]]; then
  echo "Usage: $0 [destination.app] (default: ~/Applications/Inkflit.app)" >&2
  exit 1
fi
target=${1:-"$HOME/Applications/Inkflit.app"}
[[ "$target" == /* && "$target" == *.app ]] || { echo 'Destination must be an absolute .app path' >&2; exit 1; }
# Never replace an existing installation or stop a running app implicitly.
[[ ! -e "$target" && ! -L "$target" ]] || { echo "Destination exists; choose a new path: $target" >&2; exit 1; }
npm run build
mkdir -p "$(dirname "$target")"
stage=$(mktemp -d "$(dirname "$target")/.inkflit-install.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
ditto build/Inkflit.app "$stage/Inkflit.app"
codesign --verify --deep --strict "$stage/Inkflit.app"
# macOS exclusive rename commits the verified bundle without replacing a
# destination created while the build was running (including an empty folder).
python3 - "$stage/Inkflit.app" "$target" <<'PYTHON'
import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
rename = libc.renamex_np
rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
rename.restype = ctypes.c_int
if rename(os.fsencode(sys.argv[1]), os.fsencode(sys.argv[2]), 0x00000004) != 0:  # RENAME_EXCL
    raise OSError(ctypes.get_errno(), os.strerror(ctypes.get_errno()), sys.argv[2])
PYTHON
printf 'Installed %s\n' "$target"
