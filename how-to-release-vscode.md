# Releasing RayuCode for VS Code

The extension published at **[RayuCode.rayucode](https://marketplace.visualstudio.com/items?itemName=RayuCode.rayucode)** is built from [`vscode/`](vscode/) and ships on its own version line. It is **not** tied to the CLI's `v3.0.x` tags in [`RELEASING.md`](RELEASING.md): the CLI bumps from `Cargo.toml`, the extension bumps from [`vscode/extension.manifest.json`](vscode/extension.manifest.json).

| Fact | Value |
| :--- | :--- |
| Marketplace identity | `RayuCode.rayucode` (`publisher` + `name` in `extension.manifest.json`) |
| Manifest of record | [`vscode/extension.manifest.json`](vscode/extension.manifest.json) (copied to `vscode/dist/extension/package.json` by `build.mjs`) |
| Minimum VS Code | `engines.vscode` → currently `^1.106.0` |
| Packaging tool | `@vscode/vsce` 4.x, invoked through [`vscode/package.mjs`](vscode/package.mjs) |
| Output | `vscode/dist/rayucode-<version>.vsix` (git-ignored) |
| Release script | `node scripts/publish_vscode.mjs` |
| CI workflow | [`.github/workflows/publish-vscode.yml`](.github/workflows/publish-vscode.yml) (`vscode-v*` tags) |

The extension is a **thin client**: it bundles the Rust engine bridge client, not the engine. Users still need the `rayu` CLI on the workspace host. Releasing the extension therefore never requires rebuilding or re-releasing CLI binaries, but a release that depends on a new Harness API frame does require the matching CLI to be out first.

## 1. Prepare the version

Pick one version source and keep the two in lockstep:

1. `version` in [`vscode/extension.manifest.json`](vscode/extension.manifest.json) — must be strict `MAJOR.MINOR.PATCH`. `vscode/test/workbenchPlacement.test.ts` fails the build on a prerelease tag such as `3.0.0-beta.1`.
2. A matching `## <version>` heading at the top of [`vscode/CHANGELOG.md`](vscode/CHANGELOG.md). The release script refuses to publish without it, because the Marketplace renders that section as the release notes.

Do **not** reuse a version that is already published; the gallery rejects the upload and the release script fails early with the published version in the message.

## 2. Run the preflight locally

```sh
cd rayucode-v2
node scripts/publish_vscode.mjs --preflight-only
```

This checks, without building anything:

- manifest version is strict SemVer and the publisher id is a valid gallery id,
- `engines.vscode` is present,
- `vscode/CHANGELOG.md` has a section for this version,
- the local version is not **older** than the newest version on the Marketplace (a downgrade is always refused),
- the local version is not **already published** (retrying a failed upload of the same version needs `--allow-remote-newer`; the upload then no-ops via `--skip-duplicate`).

## 3. Build, test, package

```sh
# Full gate: shared TS packages, extension host, React webview, design lint, VSIX
npm ci
npm test --workspace @rayu-dev/rayucode-vscode
npm run lint:design --workspace @rayu-dev/rayucode-vscode
node scripts/publish_vscode.mjs            # builds + packages, does NOT upload
```

`node scripts/publish_vscode.mjs` runs `npm run package:vscode` for you, which is:

```sh
npm run build:sdk && npm run build:session-core && npm run build:ui
npm run build --workspace @rayu-dev/rayucode-vscode   # tsc --noEmit + node build.mjs
npm run package:vsix --workspace @rayu-dev/rayucode-vscode
```

`build.mjs` stages `vscode/dist/extension/` (`extension.js`, `media/*`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, generated icon font and Rayu Fox assets) and `package.mjs` runs `vsce package --no-dependencies` against that staged folder. Nothing is uploaded in this step.

Sanity-check the artifact before publishing:

```sh
unzip -l vscode/dist/rayucode-<version>.vsix
unzip -p vscode/dist/rayucode-<version>.vsix extension.vsixmanifest | head -12
```

The `Identity` line must read `Publisher="RayuCode" Id="rayucode" Version="<version>"`.

## 4. Smoke-test the VSIX in a real window

```sh
code --profile rayu-vscode-release --install-extension "$PWD/vscode/dist/rayucode-<version>.vsix"
code --profile rayu-vscode-release /path/to/a/trusted/workspace
```

Use a dedicated profile so the release build never mixes with a dev build. Verify, at minimum:

- the RayuCode Fox button appears in the Editor Tab Bar and the Secondary Sidebar (`rayucode.chat`) opens,
- Mission Control (`rayucode.workspace`) loads in an editor tab,
- the bridge connects to an installed `rayu` (`rayu --no-update api-bridge`) and Runtime Doctor reports live version, PID, and latency rather than placeholders,
- one chat turn streams, and a tool approval round-trip works,
- Warm Graphite Dark, Warm Paper Light, and Match VS Code Theme all render the webview.

Alternatively launch the staged directory without a VSIX:

```sh
code --extensionDevelopmentPath="$PWD/vscode/dist/extension" /path/to/a/trusted/workspace
```

## 5. Publish

### Option A: from CI (preferred)

Push a `vscode-v*` tag at the commit you want to ship, or run the workflow manually:

```sh
git tag vscode-v3.0.0
git push origin vscode-v3.0.0
```

`publish-vscode.yml` then builds, tests, packages, publishes, and uploads the VSIX as a workflow artifact. It requires the repository secret `VSCE_PAT` (see below). The tag and `extension.manifest.json` version must agree, or the job fails before uploading. Re-running the job for an already-published version is a no-op rather than a failure.

### Option B: from your machine

```sh
export VSCE_PAT='<azure-devops-pat>'
node scripts/publish_vscode.mjs --publish
```

The script publishes the exact VSIX it just built (`vsce publish --packagePath ... --skip-duplicate`), so what you smoke-tested is what users get.

## 6. Credentials

`vsce publish` authenticates as the **`RayuCode` publisher** and needs an Azure DevOps Personal Access Token:

1. Sign in to <https://dev.azure.com> with the Microsoft account that owns the `RayuCode` publisher.
2. User settings → **Personal access tokens** → **New Token**.
3. Organization: **All accessible organizations** (a token scoped to one org is the usual cause of a `401`/`Invalid Resource` failure).
4. Scopes: **Custom defined** → **Marketplace** → **Manage** (Acquire + Publish). Nothing else is needed.
5. Set the expiry, ideally one that outlives the next release, and store it:
   - locally: `export VSCE_PAT=...` (never commit it, never add it to a shell rc in a shared machine),
   - CI: repository → Settings → Secrets and variables → Actions → `VSCE_PAT`.

vsce 4.x also supports `--oidc` (Marketplace trusted publishing) and `--azure-credential` (Microsoft Entra ID) for short-lived credentials. `publish_vscode.mjs` uses the PAT path because it works identically locally and in CI; if the team migrates to trusted publishing, add a `--oidc` passthrough and drop `VSCE_PAT` from the workflow.

Token rotation checklist: create the new PAT → update the secret → run the workflow once → revoke the old PAT.

## 7. After publishing

- The gallery takes a few minutes to serve the new build. Confirm the listing shows the version: <https://marketplace.visualstudio.com/items?itemName=RayuCode.rayucode>.
- `vsce show RayuCode.rayucode --json` lists versions directly if the page is cached.
- Verify an upgrade path from the previous release in the dedicated profile:
  `code --profile rayu-vscode-release --install-extension RayuCode.rayucode` should offer and apply the update.
- Post the changelog section wherever the team announces releases.

## 8. Rollback

The Marketplace has no "delete version" button that users see. To back out a bad release:

1. Fix forward with a new patch version (for example `3.0.1`) as soon as possible. This is the only path that reaches users who already installed the bad build.
2. If the build must disappear entirely, unpublish the version in the publisher management page (<https://marketplace.visualstudio.com/manage>). Unpublishing leaves the version number burned; you cannot re-publish the same number, so bump it.
3. Re-run the smoke test in Section 4 against the replacement VSIX before publishing it.

## 9. Pre-release channel

`vsce` supports a Marketplace pre-release flag. The RayuCode manifest deliberately rejects prerelease SemVer in tests, so a pre-release build must keep a strict `MAJOR.MINOR.PATCH` version and be packed with `--pre-release` instead. `package.mjs` forwards extra arguments to `vsce package`:

```sh
npm run package:vsix --workspace @rayu-dev/rayucode-vscode -- \
  --pre-release --out "$PWD/vscode/dist/rayucode-<version>-prerelease.vsix"
```

Publish that file with `vsce publish --pre-release --packagePath ...`. The flag asserts that the package really carries the pre-release property (`vsce` errors otherwise), and it is the only signal that keeps a preview out of the stable channel. Our release script packs stable packages only; a pre-release goes through `vsce` directly.

Pre-release installs are opt-in in VS Code, and stable users never receive them. Use this only for builds that are structurally ready but not yet cleared for the stable channel.

## 10. Troubleshooting

| Symptom | Cause and fix |
| :--- | :--- |
| `ERROR The Personal Access Token verification has failed` / `Invalid Resource` | PAT expired, wrong organization ("All accessible organizations" required), or missing **Marketplace → Manage** scope. Recreate the token. |
| `ERROR This extension cannot be published because the publisher 'RayuCode' does not exist` | Signed in with the wrong Microsoft account, or the PAT belongs to another org. The publisher must be the account that owns `RayuCode`. |
| `ERROR Version 3.0.0 is already published` | The version is used. Bump `extension.manifest.json` and `CHANGELOG.md`; do not re-upload. |
| `local 3.0.0 is older than published 3.0.1` (release script) | The Marketplace refuses downgrades. Bump the manifest version; there is no override. |
| `3.0.0 is already published` (release script) | The version is used. Bump `extension.manifest.json` and `CHANGELOG.md`; pass `--allow-remote-newer` only to retry a failed upload of the same version. |
| `vscode/CHANGELOG.md has no "## 3.0.0" section` | Add the section; the Marketplace release notes come from it. |
| `Marketplace version must be MAJOR.MINOR.PATCH without prerelease tag` | The `workbenchPlacement` test rejects `3.0.0-rc.1`. Use a strict version plus `--pre-release` for the pre-release channel. |
| VSIX installs but the panel shows "bridge not found" | The target machine has no `rayu` CLI, or `rayucode.binaryPath` is wrong. This is expected outside a machine with the engine installed; set **RayuCode › Binary Path**. |
| `vsce` warns about unused `files` patterns | A path in `files` matched nothing in the staged folder. Check `vscode/dist/extension/` contents; the build stages `media/`, not `media/**`. |
| CI job fails on `VSCE_PAT` missing | Add the secret, or skip publishing and use the CI job only to produce the VSIX artifact. |

## 11. Reference commands

```sh
# Typecheck only
npm run typecheck --workspace @rayu-dev/rayucode-vscode

# Host + webview tests
npm test --workspace @rayu-dev/rayucode-vscode

# Design token / boundary lint
npm run lint:design --workspace @rayu-dev/rayucode-vscode

# Standalone webview preview against the mock bridge
npm run dev:webview --workspace @rayu-dev/rayucode-vscode

# Build + package, no upload
node scripts/publish_vscode.mjs

# Publish the built VSIX
node scripts/publish_vscode.mjs --publish

# Inspect what the Marketplace currently serves
node vscode/node_modules/@vscode/vsce/vsce show RayuCode.rayucode --json
```
