"""Regression checks for release routing and the compatibility shell command.

The compatibility checks execute the actual selection fragment with stubbed
compiler/installer commands, not a real Docker build.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PublicReleaseTests(unittest.TestCase):
    def test_workflow_preserves_release_and_toolchains(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        # The closed-source release builds plain cargo on hosted runners, so the
        # justrust wrapper is disabled and the opt level is pinned explicitly.
        self.assertIn('RAYU_USE_PLAIN_CARGO: "1"', workflow)
        self.assertIn('CARGO_PROFILE_RELEASE_OPT_LEVEL: "3"', workflow)
        self.assertIn('CARGO_BUILD_RUSTC_WRAPPER: ""', workflow)
        cargo = (ROOT / "Cargo.toml").read_text()
        self.assertIn('[profile.release]\nopt-level = 1', cargo)
        self.assertIn('[profile.selfdev]\ninherits = "release"\nopt-level = 0', cargo)

    def test_freebsd_smoke_builds_locked_without_git_metadata(self):
        # FreeBSD has no hosted runner, so its smoke workflow is the only FreeBSD
        # guard. It must stay `--locked` and must not depend on git metadata.
        workflow = (ROOT / ".github/workflows/freebsd-smoke.yml").read_text()
        self.assertIn("cargo build --locked", workflow)
        self.assertIn("-p rayucode --bin rayu", workflow)
        self.assertNotIn("git rev-parse", workflow)

    def test_public_release_repo_is_configurable(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        self.assertIn("PUBLIC_RELEASE_REPO: ${{ vars.PUBLIC_RELEASE_REPO || 'Choeng-Rayu/rayucode-v2-releases' }}", workflow)

    def test_compatibility_ci_and_local_selection(self):
        source = (ROOT / "scripts/build_linux_compat.sh").read_text()
        self.assertIn('-e CARGO_PROFILE_RELEASE_OPT_LEVEL', source)
        self.assertIn('-e CARGO_BUILD_JOBS', source)
        self.assertIn('-e RAYU_CI_BUILD', source)
        # Execute exactly the command-selection block passed to Docker.
        fragment = source[source.index('build_command=(cargo build)'):]
        fragment = fragment[:fragment.index('\n\n        # Exercise the exact portable binary')]
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            for name in ('cargo', 'justrust', 'bash'):
                command = directory / name
                command.write_text(
                    '#!/bin/sh\n'
                    'printf "%s" "' + name + '"\n'
                    'printf " <%s>" "$@"\n'
                    'printf " toolchain=%s slots=%s level=%s\\n" '
                    '"${JUSTRUST_TOOLCHAIN:-}" "${JUSTRUST_SLOTS:-}" '
                    '"${CARGO_PROFILE_RELEASE_OPT_LEVEL:-}"\n'
                )
                command.chmod(0o755)
            for ci in ('0', '1'):
                with self.subTest(ci=ci):
                    # Stubbed commands must not be shadowed by a caller's
                    # exported self-dev Cargo function or BASH_ENV startup file.
                    env = {key: value for key, value in os.environ.items()
                           if not key.startswith('BASH_FUNC_') and key != 'BASH_ENV'}
                    env.update(PATH=f"{directory}:{os.environ['PATH']}",
                               RAYU_CI_BUILD=ci, RAYU_COMPAT_PROFILE='release',
                               RAYU_COMPAT_TARGET='x86_64-unknown-linux-gnu',
                               CARGO_PROFILE_RELEASE_OPT_LEVEL='3')
                    result = subprocess.run(['/bin/bash', '-eu', '-c', fragment],
                                            env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn('<--locked>', result.stdout)
                    self.assertIn('<--profile> <release> <--target> <x86_64-unknown-linux-gnu>', result.stdout)
                    self.assertIn('<linux-compat-vendored-openssl>', result.stdout)
                    if ci == '1':
                        self.assertIn('bash <scripts/install_justrust_ci.sh>', result.stdout)
                        self.assertIn('justrust <build> <--local>', result.stdout)
                        self.assertIn('toolchain=system slots=0 level=3', result.stdout)
                    else:
                        self.assertIn('cargo <build>', result.stdout)
                        self.assertNotIn('install_justrust', result.stdout)
                        self.assertNotIn('justrust <build>', result.stdout)

    def test_provenance_check_drains_version_output(self):
        source = (ROOT / 'scripts/build_linux_compat.sh').read_text()
        fragment = source[source.index('if [[ -n "$git_hash" ]]; then'):]
        with tempfile.TemporaryDirectory() as temp:
            binary = Path(temp) / 'rayu.bin'
            binary.write_text('#!/usr/bin/env python3\n'
                              'import sys\n'
                              'print("version\\tv1.0.0 (abc123)", flush=True)\n'
                              'sys.stdout.write("details\\t" + "x" * 1000000)\n')
            binary.chmod(0o755)
            env = dict(os.environ, git_hash='abc123', out_dir=temp, artifact='rayu')
            result = subprocess.run(['/bin/bash', '-euo', 'pipefail', '-c', fragment],
                                    env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_cloud_artifact_gate_rejects_missing_protocol_and_newer_glibc(self):
        source = (ROOT / "scripts/build_linux_compat.sh").read_text()
        fragment = source[source.index('        built="$CARGO_TARGET_DIR/'):]
        fragment = fragment[:fragment.index('\n\n\t    cp ')]
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            binary = directory / 'target/x86_64-unknown-linux-gnu/release/rayu'
            binary.parent.mkdir(parents=True)
            binary.write_text(
                '#!/bin/sh\n'
                'printf "%s\\n" "$*" >> "$TEST_CALLS"\n'
                'case "$*" in *"cloud ${FAIL_CLOUD:-never} --help"*) exit 1 ;; esac\n'
            )
            binary.chmod(0o755)
            objdump = directory / 'objdump'
            objdump.write_text('#!/bin/sh\nprintf "0000 DF .text %s symbol\\n" "$TEST_GLIBC_SYMBOL"\n')
            objdump.chmod(0o755)
            for glibc, missing in [('2.17', ''), ('2.17-legacy', ''), ('2.34-legacy', ''), ('2.34', ''), ('2.17', 'receive'),
                                   ('2.17', 'credentials'), ('2.17', 'cancel-return')]:
                with self.subTest(glibc=glibc, missing=missing):
                    calls = directory / 'calls'
                    calls.write_text('')
                    env = dict(os.environ, PATH=f"{directory}:{os.environ['PATH']}",
                               CARGO_TARGET_DIR=str(directory / 'target'),
                               RAYU_COMPAT_TARGET='x86_64-unknown-linux-gnu',
                               RAYU_COMPAT_PROFILE='release',
                               TEST_GLIBC_SYMBOL=('GLIBC_' + glibc.removesuffix('-legacy')
                                                  if glibc.endswith('-legacy') else f'(GLIBC_{glibc})'),
                               FAIL_CLOUD=missing, TEST_CALLS=str(calls))
                    result = subprocess.run(['/bin/bash', '-euo', 'pipefail', '-c', fragment],
                                            env=env, capture_output=True, text=True)
                    if glibc.removesuffix('-legacy') == '2.17' and not missing:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        for command in ['receive', 'credentials', 'cancel-return']:
                            self.assertIn(f'cloud {command} --help', calls.read_text())
                    else:
                        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
