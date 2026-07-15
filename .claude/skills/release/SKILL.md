---
name: release
description: Build Kraken's macOS/Windows/Linux desktop binaries and publish a tagged GitHub release with all three attached. Use whenever the user asks to cut a release, publish a new version, ship an update, or build release binaries for this app — trigger on phrases like "publish a release", "cut v0.x.x", "ship a new version", "build the binaries and put out a release", even if they don't say "skill" or reference this by name.
---

# Release

This repo's distributable is a desktop app named **Kraken** (`deno.json`'s
`desktop.app` identity — don't touch that again, it's already set), built
with `deno desktop` for macOS, Windows, and Linux, and published as a
GitHub release with all three binaries attached.

## Before you touch anything

Publishing creates a pushed git tag and a public GitHub release — visible
to anyone watching the repo, and not something to casually undo. Building
locally is harmless and reversible; **tagging and `gh release create` are
not**. Only do those once the user has clearly asked you to publish or
ship — not just asked how the release process works, or asked you to
prepare. If that's ambiguous, ask before tagging.

Before starting:

- `git status` is clean and you're on `main`. `gh auth status` shows
  you're logged in.
- Decide the version number. If the user gave one, use it. If they
  didn't, look at what's changed since the last tag (`gh release list`,
  then `git log <last-tag>..HEAD --oneline`) and propose a semver bump —
  but confirm the actual bump type (patch/minor/major) with the user
  rather than guessing; that's a judgment call about the changes, not
  something to auto-decide.
- `deno.json`'s top-level `"version"` field should match the new tag. If
  it doesn't, update it and commit that first, so the package version and
  the release tag never drift apart.

## Build and package

Run the bundled script from the repo root:

```bash
.claude/skills/release/scripts/build-release-binaries.sh
```

It builds all three platforms (`deno task build:macos` / `build:windows`
/ `build:linux` — each task already carries the right `--target` triple,
don't remove those) and packages each into one archive under
`release/dist/`:

- `Kraken-macos-arm64.zip`
- `Kraken-windows-x64.zip`
- `Kraken-linux-x64.tar.gz`

The script prints a sanity check (archive contents + sizes) at the end —
actually read that output rather than assuming success. Expect roughly
150–450MB per archive; something far outside that range means a build
step silently failed.

## Do NOT use `deno desktop --all-targets` yourself

Don't hand-roll a build with `--all-targets` and a single shared `-o`
path, even though it looks like the obvious one-command shortcut.
`--all-targets` builds all 5 supported targets (two macOS archs, one
Windows, two Linux archs) but only disambiguates output paths by file
*extension* — the two macOS builds (both `.app`) and the two Linux builds
(both extensionless) silently overwrite each other at the same path. This
was a real bug hit the first time this release process was run. Always
go through the bundled script above (or the three individual
`deno task build:<platform>` commands, which each have their own
distinct, safe output path) — never a bare `--all-targets` invocation.

## Tag and publish

Once the archives in `release/dist/` look right:

```bash
git tag -a vX.Y.Z -m "Kraken vX.Y.Z"
git push origin vX.Y.Z

gh release create vX.Y.Z \
  release/dist/Kraken-macos-arm64.zip \
  release/dist/Kraken-windows-x64.zip \
  release/dist/Kraken-linux-x64.tar.gz \
  --title "Kraken vX.Y.Z" \
  --generate-notes
```

`--generate-notes` autofills release notes from commits merged since the
previous tag.

## Verify

```bash
gh release view vX.Y.Z --json name,tagName,assets,url \
  -q '.name, .tagName, .url, ([.assets[] | .name + " (" + (.size / 1048576 | floor | tostring) + " MB)"] | join("\n"))'
```

Confirm the tag, title, and all three assets with plausible sizes are
actually there — don't declare the release done from the `gh release
create` command's own exit code alone.

If the tag or version bump touched anything CI checks, give it a moment
and glance at `gh run list --limit 1` before wrapping up.

## Clean up

```bash
rm -rf release
```

It's gitignored, disposable build output — safe to delete once the
release is confirmed live. Also check the repo root for a stray
`.selfextract-*` directory (a `deno desktop` scratch dir left behind by
an interrupted build) and remove it if present.
