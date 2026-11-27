#!/usr/bin/env node
/**
 * Build, validate, and optionally publish the RayuCode VS Code extension.
 *
 *   node scripts/publish_vscode.mjs                      # preflight + build + package
 *   node scripts/publish_vscode.mjs --preflight-only     # validate, nothing built
 *   node scripts/publish_vscode.mjs --publish            # package, then upload
 *   node scripts/publish_vscode.mjs --publish --skip-build
 *
 * Auth: VSCE_PAT (Azure DevOps PAT with the Marketplace > Manage scope), or
 * `--pat <token>` for a one-off run. A token is never written anywhere.
 *
 * The Marketplace listing is RayuCode.rayucode. Identity comes from
 * vscode/extension.manifest.json, which build.mjs also stages into the VSIX.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Marketplace metadata rules that `vsce` enforces at upload time. */
export function validateManifest(manifest, changelog) {
  if (!SEMVER.test(manifest.version ?? '')) {
    return `version must be MAJOR.MINOR.PATCH without a prerelease tag (got ${manifest.version})`;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(manifest.publisher ?? '')) {
    return `publisher "${manifest.publisher}" is not a valid Marketplace publisher id`;
  }
  if (!manifest.name) return 'name is required';
  if (!manifest.engines?.vscode) return 'manifest.engines.vscode is required';
  if (!changelogHasVersion(changelog, manifest.version)) {
    return `vscode/CHANGELOG.md has no "## ${manifest.version}" section`;
  }
  return null;
}

export function changelogHasVersion(changelog, version) {
  return new RegExp(`^##\\s+${version.replaceAll('.', '\\.')}(?:\\s|$)`, 'm').test(changelog);
}

/**
 * Gallery-side guard: refuse downgrades outright, and refuse a duplicate publish
 * unless the caller explicitly allows retrying an already-published version.
 */
export function checkRemoteVersion(local, latest, allowRemoteNewer) {
  if (!latest) return null;
  const order = compareSemver(local, latest);
  if (order < 0) {
    return (
      `local ${local} is older than published ${latest}. The Marketplace will not ` +
      'accept a downgrade; bump vscode/extension.manifest.json.'
    );
  }
  if (order === 0 && !allowRemoteNewer) {
    return (
      `${local} is already published. Bump vscode/extension.manifest.json and ` +
      'vscode/CHANGELOG.md, or pass --allow-remote-newer to retry an existing ' +
      'version (the upload then no-ops via --skip-duplicate).'
    );
  }
  return null;
}

/** Numeric compare of strict MAJOR.MINOR.PATCH versions. A prerelease sorts before its release. */
export function compareSemver(a, b) {
  const parse = (value) => {
    const [core, prerelease] = String(value).split('+')[0].split('-');
    const [major, minor, patch] = core.split('.').map(Number);
    return { major, minor, patch, prerelease: prerelease ?? null };
  };
  const left = parse(a);
  const right = parse(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

export function latestVersion(versions) {
  return versions.reduce(
    (best, version) => (!best || compareSemver(version, best) > 0 ? version : best),
    '',
  );
}

/** Resolve `Publisher.Name` -> version strings currently on the gallery. */
export async function marketplaceVersions(extensionName) {
  const response = await fetch(
    'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json;api-version=7.2-preview.1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filters: [
          {
            criteria: [{ filterType: 7, value: extensionName }],
            pageNumber: 1,
            pageSize: 1,
          },
        ],
        flags: 914,
      }),
    },
  );
  if (!response.ok) throw new Error(`Marketplace query failed with HTTP ${response.status}`);
  const body = await response.json();
  const extension = body.results?.[0]?.extensions?.[0];
  return extension ? (extension.versions ?? []).map((entry) => entry.version) : [];
}

function fail(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

function step(message) {
  console.log(`\n▸ ${message}`);
}

function run(command, argv, cwd = ROOT) {
  const result = spawnSync(command, argv, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${command} ${argv.join(' ')} exited with ${result.status}`);
}

export async function main(argv = process.argv.slice(2)) {
  const flag = (name) => argv.includes(`--${name}`);
  const value = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const vscodeDir = join(ROOT, 'vscode');
  const manifest = JSON.parse(readFileSync(join(vscodeDir, 'extension.manifest.json'), 'utf8'));
  const changelog = readFileSync(join(vscodeDir, 'CHANGELOG.md'), 'utf8');
  const pat = value('pat') ?? process.env.VSCE_PAT;
  const identity = `${manifest.publisher}.${manifest.name}`;

  step('Validating manifest');
  const invalid = validateManifest(manifest, changelog);
  if (invalid) fail(invalid);
  console.log(`  ${identity} ${manifest.version}`);

  step('Comparing with the Marketplace');
  let published = [];
  try {
    published = await marketplaceVersions(identity);
  } catch (error) {
    fail(`could not read Marketplace versions: ${error.message}`);
  }
  const latest = latestVersion(published);
  console.log(`  published: ${latest || '(new listing)'}   local: ${manifest.version}`);
  const remoteError = checkRemoteVersion(manifest.version, latest, flag('allow-remote-newer'));
  if (remoteError) fail(remoteError);

  if (flag('preflight-only')) {
    console.log('\nPreflight OK (nothing built).\n');
    return;
  }

  step('Building and packaging the VSIX');
  if (flag('skip-build')) {
    console.log('  skipped (--skip-build)');
  } else {
    run('npm', ['run', 'package:vscode']);
  }
  const vsix = join(vscodeDir, 'dist', `${manifest.name}-${manifest.version}.vsix`);
  if (!existsSync(vsix)) fail(`expected VSIX at ${vsix}; run without --skip-build`);
  console.log(`  ${vsix}`);

  if (!flag('publish')) {
    console.log('\nPackaged only. Re-run with --publish to upload.\n');
    return;
  }

  if (!pat) fail('VSCE_PAT is not set (or pass --pat <token>)');

  step('Publishing to the Visual Studio Marketplace');
  const vsce = join(
    dirname(require.resolve('@vscode/vsce/package.json', { paths: [vscodeDir] })),
    'vsce',
  );
  run(
    process.execPath,
    [vsce, 'publish', '--packagePath', vsix, '--pat', pat, '--skip-duplicate'],
    vscodeDir,
  );
  console.log(`\nPublished ${identity} ${manifest.version}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
