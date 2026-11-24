#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -m)" != arm64 ]]; then echo "Apple Silicon Mac required" >&2; exit 1; fi
# The version lives in package.json only.
VERSION="$(node -p "require('./package.json').version")"
[[ "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "Expected a stable version" >&2; exit 1; }
output_dir="${INKFLIT_RELEASE_OUTPUT_DIR:-dist}"
filename="Inkflit-$VERSION-macos-arm64.dmg"
output="$output_dir/$filename"
updates="$output_dir/updates/$VERSION"
if [[ -e "$output" ]]; then echo "Refusing to overwrite $output" >&2; exit 1; fi
if [[ -e "$updates" ]]; then echo "Refusing to overwrite $updates" >&2; exit 1; fi
npm run build
sparkle="$(bash scripts/sparkle.sh)"
account=xyz.phpz.app.inkflit
public_key="$(/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' build/Inkflit.app/Contents/Info.plist)"
if [[ "$("$sparkle/bin/generate_keys" --account "$account" -p)" != "$public_key" ]]; then
  echo "The Sparkle key in Keychain for $account must match the app's public key." >&2
  exit 1
fi
work="$(mktemp -d "${TMPDIR:-/tmp}/inkflit-release.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT
stage="$work/image"
mkdir "$stage" "$work/updates"
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
hdiutil create -volname "Inkflit $VERSION" -srcfolder "$stage" -fs HFS+ -format UDZO "$work/updates/$filename" >/dev/null
hdiutil verify "$work/updates/$filename" >/dev/null
download_prefix="https://github.com/dofy/Inkflit/releases/download/v$VERSION/"
"$sparkle/bin/generate_appcast" --account "$account" --maximum-deltas 0 \
  --link https://inkflit.phpz.org/ \
  --download-url-prefix "$download_prefix" "$work/updates"
appcast="$work/updates/appcast.xml"
grep -Fq "url=\"$download_prefix$filename\"" "$appcast"
"$sparkle/bin/sign_update" --account "$account" --verify "$appcast"
mkdir -p "$output_dir/updates"
mkdir "$updates"
mv -n "$appcast" "$updates/appcast.xml"
mv -n "$work/updates/$filename" "$output"
[[ ! -e "$work/updates/$filename" ]]
printf 'Created %s\nCreated %s\n' "$output" "$updates/appcast.xml"
