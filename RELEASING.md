# Releasing `portal-mojo`

Release verification requires Node 24.21.0 and npm 11.19.0, matching CI and
the packaged Admin producer. Install dependencies with `npm ci`.

One command publishes a stable release:

```bash
npm run release
```

That creates the next patch version. Use `npm run release:minor` or
`npm run release:major` when the public API change requires it.

The command deliberately uses only npm and Git. It requires a clean `main`
that exactly matches `origin/main`, then it:

1. updates the package version and lockfile;
2. runs the complete release verification, including the real npm tarball in
   a clean consumer;
3. commits `Release portal-mojo vX.Y.Z` and creates the matching tag; and
4. atomically pushes `main` and the tag.

Pushing the tag triggers GitHub Actions, which verifies the tagged commit again
and publishes through npm Trusted Publishing. Developers do not need the
GitHub CLI, an npm login, or a publishing token. Ordinary pushes to `main` do
not publish.

If verification fails, the command restores the two version files and pushes
nothing. If the final push fails, it leaves the release commit and tag locally
and prints the exact retry command instead of creating another version.

Published versions and tags are immutable. Fix a bad release with another
patch; deprecate the bad npm version when appropriate. Never move a published
tag or reuse a published version.

## One-time setup

`portal-mojo@0.1.0` was published interactively to establish the package. npm
Trusted Publishing must authorize GitHub repository `NativeMojo/portal-mojo`,
workflow `release.yml`, environment `npm-production`, and action `npm publish`.
No `NPM_TOKEN` secret is used or required.

## Built-in Django Admin artifact

The npm toolkit and the static Django Admin artifact are separate outputs.
`npm run build:admin -- --canonical` creates a clean, same-origin `dist/admin`
with its exhaustive versioned integrity inventory. Never vendor ordinary
`apps/portal/dist` or a draft (`source_dirty: true`). `verify:release` includes
runtime/session fixtures and two fresh builds with exact manifest-byte equality.
The release command's pre-commit verification uses truthful draft provenance;
the tagged CI run builds and retains the clean canonical artifact afterward.

CI/release retains all of `dist/admin`, including hidden `.vite` metadata,
as `portal-mojo-admin-<version>-<full-revision>` for 90 days. Django vendors the
verified directory and retains the durable source copy. Record the retrieval
location, source revision, exact toolchain and SHA-256 of `admin-artifact.json`
on the paired producer/consumer work items before downstream acceptance.
See [the artifact and source-session contract](docs/admin-artifact.md), including
offline identity checks, recovery, CSP test ownership and immutable replacement.
