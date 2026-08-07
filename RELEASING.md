# Releasing `portal-mojo`

Releases are deliberately boring: version on `main`, verify the exact npm
tarball, then publish a GitHub Release. GitHub Actions publishes that immutable
version to npm. Do not publish routinely from a developer laptop.

## One-time npm bootstrap

The unscoped package name `portal-mojo` is public and currently unclaimed. npm
cannot attach a trusted publisher until the package exists, so the first
release needs one temporary token:

1. Sign in to npm as the existing `nativemojo` account and create a granular
   access token that can publish packages, with **Bypass 2FA** enabled.
2. In GitHub, create the protected environment `npm-production`, then add the
   token as its `NPM_TOKEN` environment secret.
3. Merge version `0.1.0` to `main`, create tag `v0.1.0` from that commit, and
   publish a GitHub Release for the tag. Watch the **Publish portal-mojo**
   workflow complete.
4. On npm, open `portal-mojo` package settings and configure a GitHub Actions
   trusted publisher for organization `NativeMojo`, repository `portal-mojo`,
   workflow `release.yml`, environment `npm-production`, and allowed action
   `npm publish`.
5. Delete `NPM_TOKEN` from GitHub and revoke the npm token. Set the package's
   publishing access to require 2FA and disallow tokens. Future releases use
   GitHub OIDC and npm provenance without a shared credential.

The bootstrap token is intentionally confined to a protected GitHub
environment. It never belongs in this repository, a shell profile, or another
developer's machine.

## Every release

1. Start from current `main` and choose the SemVer change:

   ```bash
   npm run version:patch   # or version:minor / version:major
   npm run verify:release
   ```

2. Review and commit both `packages/portal-mojo/package.json` and
   `package-lock.json`, then merge through the normal review process.
3. From the merged `main` commit, create and push the matching tag, for example
   `v0.1.1`, and publish a GitHub Release for it. Prefer the GitHub UI so the
   release and notes are visible to the whole team. Wait for that publish to
   finish before creating the next release.
4. Confirm the workflow completed and that `npm view portal-mojo@0.1.1 version`
   returns the new version.

The workflow refuses prereleases, a tag that does not exactly match the package
version, a release commit that is not on `main`, or a version that is not newer
than npm's current `latest`. This prevents an out-of-order run from moving
`latest` backward. npm versions are immutable: if publishing fails after npm
accepts a version, bump again instead of moving the tag or rebuilding it.

Do not use `npm run release:publish` locally for normal releases. It exists so
the workflow and an authorized emergency operator share one publish command.
