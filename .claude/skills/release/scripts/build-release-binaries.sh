#!/usr/bin/env bash
# Builds Kraken for macOS (arm64), Windows (x64), and Linux (x64) via
# `deno desktop`, then packages each into a single archive under
# release/dist/ — ready to hand to `gh release create`.
#
# Deliberately does NOT touch git or GitHub: tagging and publishing are
# separate, visible steps a human should confirm (see ../SKILL.md).
#
# All three platforms build as directory bundles (.app on macOS, a folder
# with the .exe + supporting .dll on Windows, a folder with the binary +
# .so on Linux) — that's why each gets archived here rather than uploaded
# raw; `gh release create`/`upload` reject bare directories.
set -euo pipefail

repo_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
cd "$repo_root"

echo "==> Building macOS (aarch64-apple-darwin)…"
deno task build:macos

echo "==> Building Windows (x86_64-pc-windows-msvc)…"
deno task build:windows

echo "==> Building Linux (x86_64-unknown-linux-gnu)…"
deno task build:linux

echo "==> Packaging archives…"
rm -rf release/dist
mkdir -p release/dist

# ditto (not zip) for macOS: preserves the code-signature and resource
# forks that a plain `zip` would silently strip.
ditto -c -k --sequesterRsrc --keepParent release/macos/Kraken.app release/dist/Kraken-macos-arm64.zip
ditto -c -k release/windows/Kraken release/dist/Kraken-windows-x64.zip
tar -czf release/dist/Kraken-linux-x64.tar.gz -C release/linux kraken

echo
echo "==> Sanity check (actually look at this, don't just assume it worked):"
echo "--- macOS zip ---"
unzip -l release/dist/Kraken-macos-arm64.zip | head -5
echo "--- Windows zip ---"
unzip -l release/dist/Kraken-windows-x64.zip | grep -i '\.exe'
echo "--- Linux tarball ---"
tar -tzf release/dist/Kraken-linux-x64.tar.gz | head -5
echo
echo "--- sizes ---"
du -sh release/dist/*

echo
echo "Archives ready in release/dist/. Next: tag + gh release create (see ../SKILL.md)."
