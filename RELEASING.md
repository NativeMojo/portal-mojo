# Releasing `portal-mojo`

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
