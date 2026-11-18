#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -m)" != arm64 ]]; then echo "Apple Silicon Mac required" >&2; exit 1; fi
npm run build
# The version lives in package.json only.
VERSION="$(node -p "require('./package.json').version")"
output="dist/Inkflit-$VERSION-macos-arm64.dmg"
if [[ -e "$output" ]]; then echo "Refusing to overwrite $output" >&2; exit 1; fi
mkdir -p dist
stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
ditto "build/Inkflit.app" "$stage/Inkflit.app"
codesign --force --deep --sign - --timestamp=none "$stage/Inkflit.app"
codesign --verify --deep --strict "$stage/Inkflit.app"
archs="$(lipo -archs "$stage/Inkflit.app/Contents/MacOS/Inkflit")"
[[ "$archs" == arm64 ]] || { echo "Unexpected architectures: $archs" >&2; exit 1; }
ln -s /Applications "$stage/Applications"
cat > "$stage/Read Me.txt" <<'NOTE'
Drag the app to Applications. This build is not notarized by Apple.
After trying to open it, go to System Settings > Privacy & Security > Open Anyway.
确认信任下载来源后，将应用拖入「应用程序」，尝试打开，再前往「系统设置」>「隐私与安全性」>「仍要打开」。
NOTE
hdiutil create -volname "Inkflit $VERSION" -srcfolder "$stage" -fs HFS+ -format UDZO "$output" >/dev/null
hdiutil verify "$output" >/dev/null
printf 'Created %s\n' "$output"
