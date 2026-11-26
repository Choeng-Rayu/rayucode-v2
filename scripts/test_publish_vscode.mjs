import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  changelogHasVersion,
  checkRemoteVersion,
  compareSemver,
  latestVersion,
  validateManifest,
} from './publish_vscode.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('../vscode/extension.manifest.json', import.meta.url), 'utf8'),
);
const changelog = readFileSync(new URL('../vscode/CHANGELOG.md', import.meta.url), 'utf8');

test('the checked-in manifest is publishable', () => {
  assert.equal(validateManifest(manifest, changelog), null);
});

test('versions must be strict MAJOR.MINOR.PATCH', () => {
  for (const version of ['3.0', '3.0.0.0', '3.0.0-rc.1', 'v3.0.0', '']) {
    const error = validateManifest({ ...manifest, version }, changelog);
    assert.match(error ?? '', /MAJOR\.MINOR\.PATCH/, `accepted ${JSON.stringify(version)}`);
  }
});

test('publisher and engines are required at upload time', () => {
  assert.match(validateManifest({ ...manifest, publisher: 'Rayu Code' }, changelog) ?? '', /publisher/);
  assert.match(validateManifest({ ...manifest, publisher: '' }, changelog) ?? '', /publisher/);
  assert.match(validateManifest({ ...manifest, engines: {} }, changelog) ?? '', /engines\.vscode/);
});

test('the changelog must document the published version', () => {
  assert.equal(changelogHasVersion(changelog, manifest.version), true);
  assert.equal(changelogHasVersion(changelog, '99.0.0'), false);
  assert.match(validateManifest(manifest, '# Changelog\n') ?? '', /CHANGELOG\.md/);
  // A prefix match must not pass: 3.0 must not be satisfied by "## 3.0.0".
  assert.equal(changelogHasVersion('## 3.0.0\n', '3.0'), false);
});

test('semver comparison is numeric and prerelease-aware', () => {
  assert.ok(compareSemver('3.0.10', '3.0.9') > 0);
  assert.ok(compareSemver('2.5.3', '3.0.0') < 0);
  assert.equal(compareSemver('3.0.0', '3.0.0'), 0);
  assert.ok(compareSemver('3.0.0-rc.1', '3.0.0') < 0);
  assert.ok(compareSemver('3.0.0-rc.1', '3.0.0-rc.2') < 0);
});

test('latestVersion ignores ordering of the gallery response', () => {
  assert.equal(latestVersion(['2.5.3', '2.5.2', '2.4.64']), '2.5.3');
  assert.equal(latestVersion(['2.4.64', '2.5.3', '2.5.2']), '2.5.3');
  assert.equal(latestVersion([]), '');
});

test('downgrades are refused and duplicates need an explicit override', () => {
  assert.equal(checkRemoteVersion('3.0.0', '2.5.3', false), null);
  assert.equal(checkRemoteVersion('3.0.1', '3.0.0', false), null);
  assert.match(checkRemoteVersion('3.0.0', '3.0.1', true) ?? '', /downgrade/);
  assert.match(checkRemoteVersion('3.0.0', '3.0.0', false) ?? '', /already published/);
  assert.equal(checkRemoteVersion('3.0.0', '3.0.0', true), null);
  // A brand-new listing has nothing to compare against.
  assert.equal(checkRemoteVersion('3.0.0', '', false), null);
});
