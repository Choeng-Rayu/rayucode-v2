#!/usr/bin/env python3
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("verifier", ROOT / "scripts/verify_public_release.py")
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)
TAG = "v0.98.1"
SHA = "a" * 40


def metadata():
    return {"tag_name": TAG, "draft": False, "prerelease": False,
            "assets": [{"name": name, "size": 1, "state": "uploaded"}
                       for name in sorted(verifier.REQUIRED)]}


class PublicReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get("RAYU_SCRATCH_DIR"))
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.names = verifier.verify_metadata(metadata(), TAG)
        for name in self.names - {"SHA256SUMS"}:
            (self.directory / name).write_bytes(b"fixture")
        (self.directory / "release-provenance.json").write_text(json.dumps({
            "tag": TAG, "tag_commit": SHA, "repair": "none",
            "eligibility_policy": "exact-sha-main-ci"}))
        self.write_checksums()

    def write_checksums(self):
        (self.directory / "SHA256SUMS").write_text("".join(
            f"{hashlib.sha256((self.directory / name).read_bytes()).hexdigest()}  {name}\n"
            for name in sorted(self.names - {"SHA256SUMS"})))

    def verify(self):
        verifier.verify_downloads(self.directory, self.names, TAG, SHA)

    def test_complete_release_passes(self):
        self.verify()

    def test_packaged_notices_and_standalone_executable(self):
        archive_path = self.directory / "rayu-windows-x86_64.tar.gz"
        standalone = archive_path.with_suffix("").with_suffix(".exe")
        license_text = (ROOT / "LICENSE").read_bytes()
        evidence = b"Example dependency license"
        digest = hashlib.sha256(evidence).hexdigest()
        notices = ((ROOT / "THIRD_PARTY_NOTICES").read_bytes()
                   + f"\nLicense text SHA-256: {digest}\n\n".encode() + evidence + b"\n")
        binary = b"MZ-test-executable\0" + license_text + b"\0" + notices
        inventory = {
            "format": 1, "target": "x86_64-pc-windows-msvc",
            "cargo_lock_sha256": "a" * 64,
            "packages": [{"name": "rayucode", "source": None},
                         {"name": "example", "source": "registry+example",
                          "notices": [{"sha256": digest}]}],
            "unresolved_notices": [],
        }
        standalone.write_bytes(binary)

        def make_archive(extra=None, omitted=None):
            files = {
                standalone.name: binary, "LICENSE": license_text, "THIRD_PARTY_NOTICES": notices,
                "dependency-inventory.json": json.dumps(inventory).encode(),
            }
            if extra:
                files[extra] = b"file"
            if omitted:
                del files[omitted]
            with tarfile.open(archive_path, "w:gz") as archive:
                for name, data in files.items():
                    member = tarfile.TarInfo(name)
                    member.size = len(data)
                    archive.addfile(member, io.BytesIO(data))

        make_archive()
        verifier.verify_archive(archive_path, standalone)
        make_archive(omitted="THIRD_PARTY_NOTICES")
        with self.assertRaisesRegex(ValueError, "missing archive members"):
            verifier.verify_archive(archive_path, standalone)
        make_archive(extra="libcrypto.so")
        with self.assertRaisesRegex(ValueError, "unreviewed archive member"):
            verifier.verify_archive(archive_path, standalone)
        inventory["unresolved_notices"] = ["example 1.0.0"]
        make_archive()
        with self.assertRaisesRegex(ValueError, "missing verified dependency notices"):
            verifier.verify_archive(archive_path, standalone)
        inventory["unresolved_notices"] = []
        inventory["packages"][1]["notices"][0]["sha256"] = "1" * 64
        make_archive()
        with self.assertRaisesRegex(ValueError, "missing notice evidence"):
            verifier.verify_archive(archive_path, standalone)
        inventory["packages"][1]["notices"][0]["sha256"] = digest
        make_archive()
        standalone.write_bytes(binary + b"wrong file")
        with self.assertRaisesRegex(ValueError, "differs from archive"):
            verifier.verify_archive(archive_path, standalone)

    def test_draft_validation_is_explicit_and_still_checks_assets(self):
        data = metadata()
        data["draft"] = True
        with self.assertRaises(ValueError):
            verifier.verify_metadata(data, TAG)
        self.assertEqual(verifier.verify_metadata(data, TAG, allow_draft=True), self.names)
        data["assets"].pop()
        with self.assertRaisesRegex(ValueError, "Missing required"):
            verifier.verify_metadata(data, TAG, allow_draft=True)
        for value in (None, 0, "true"):
            data = metadata()
            data["draft"] = value
            with self.assertRaises(ValueError):
                verifier.verify_metadata(data, TAG, allow_draft=True)

    def test_workflow_verifies_anonymously_after_publishing(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        publish = workflow.index("  publish-public-release:")
        verify = workflow.index("  verify-public-release:")
        self.assertLess(publish, verify)
        step = workflow[verify:]
        # The verification job must prove anonymous access, so it may not carry a token.
        self.assertIn("unset GITHUB_TOKEN GH_TOKEN || true", step)
        self.assertNotIn("continue-on-error", step)
        # Publication must be gated on the complete platform asset set.
        self.assertIn("Missing required release asset:", workflow[publish:verify])
        self.assertIn("sha256sum -c SHA256SUMS", step)
        self.assertIn('meta_ver=$(curl -fsSL', step)
        self.assertIn('${GITHUB_REPOSITORY}/release-metadata/releases/latest/version', step)
        self.assertNotIn("rayucode-v2-releases", workflow)
        self.assertNotIn("PUBLIC_RELEASE_TOKEN", workflow)
        # Sandboxed installer smoke test: isolated HOME, pinned version.
        self.assertIn("install_home=$(mktemp -d)", step)
        self.assertIn('HOME="$install_home"', step)
        self.assertIn('RAYU_VERSION="$RELEASE_TAG"', step)
        self.assertIn("RAYU_SKIP_SERVER_RELOAD=1 RAYU_NO_TELEMETRY=1", step)
        self.assertIn('"$install_home/.local/bin/rayu" --version', step)

    def test_incomplete_metadata_rejected(self):
        for field, value in (("draft", True), ("prerelease", True), ("tag_name", "v0.98.0")):
            with self.subTest(field=field):
                data = metadata()
                data[field] = value
                with self.assertRaises(ValueError):
                    verifier.verify_metadata(data, TAG)
        data = metadata()
        data["assets"].pop()
        with self.assertRaises(ValueError):
            verifier.verify_metadata(data, TAG)

    def test_invalid_asset_metadata_rejected(self):
        for field, value in (("name", "../unsafe"), ("name", "..\\unsafe"),
                             ("size", 0), ("size", True), ("state", "new")):
            with self.subTest(field=field, value=value):
                data = metadata()
                data["assets"][0][field] = value
                with self.assertRaises(ValueError):
                    verifier.verify_metadata(data, TAG)
        data = metadata()
        data["assets"].append(copy.deepcopy(data["assets"][0]))
        with self.assertRaises(ValueError):
            verifier.verify_metadata(data, TAG)

    def test_corrupted_asset_rejected(self):
        (self.directory / "rayu-linux-x86_64.tar.gz").write_bytes(b"corrupted")
        with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
            self.verify()

    def test_checksum_coverage_and_format_rejected(self):
        path = self.directory / "SHA256SUMS"
        original = path.read_text()
        for content in ("", original.splitlines()[0] + "\n", original + original.splitlines()[0] + "\n",
                        original + "a" * 64 + "  ../unsafe\n", original + "invalid\n"):
            with self.subTest(content=content[:80]):
                path.write_text(content)
                with self.assertRaises(ValueError):
                    self.verify()

    def test_missing_and_symlinked_download_rejected(self):
        path = self.directory / "rayu-linux-x86_64.tar.gz"
        path.unlink()
        with self.assertRaisesRegex(ValueError, "Missing or unsafe"):
            self.verify()
        path.symlink_to(self.directory / "rayu-linux-aarch64.tar.gz")
        with self.assertRaisesRegex(ValueError, "Missing or unsafe"):
            self.verify()

    def test_wrong_commit_or_repaired_provenance_rejected(self):
        path = self.directory / "release-provenance.json"
        original = json.loads(path.read_text())
        for field, value in (("tag", "v0.98.0"), ("tag_commit", "b" * 40),
                             ("repair", "windows-listener"), ("eligibility_policy", "bypassed")):
            with self.subTest(field=field):
                data = dict(original, **{field: value})
                path.write_text(json.dumps(data))
                self.write_checksums()
                with self.assertRaisesRegex(ValueError, "provenance"):
                    self.verify()

    def test_draft_lookup_lists_releases_instead_of_tag_endpoint(self):
        draft = dict(metadata(), draft=True)
        calls = []

        def fake_check_output(args):
            calls.append(args)
            if "releases/tags/" in args[-1]:
                raise AssertionError("tag endpoint 404s for drafts")
            page = int(args[-1].rsplit("page=", 1)[1])
            if page == 1:
                return json.dumps([{"tag_name": f"v0.0.{i}"} for i in range(100)]).encode()
            return json.dumps([draft]).encode()

        original = verifier.subprocess.check_output
        verifier.subprocess.check_output = fake_check_output
        self.addCleanup(setattr, verifier.subprocess, "check_output", original)
        found = verifier.fetch_release_metadata("o/r", TAG, allow_draft=True)
        self.assertEqual(found, draft)
        self.assertEqual(len(calls), 2)

    def test_release_licenses_attach_uses_string_paths_for_python_312_stream_mode(self):
        spec = importlib.util.spec_from_file_location("release_licenses", ROOT / "scripts/release_licenses.py")
        licenses = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(licenses)
        archive_path = self.directory / "sample.tar.gz"
        with tarfile.open(archive_path, "w:gz") as archive:
            info = tarfile.TarInfo("rayu-linux-aarch64")
            payload = b"binary-payload"
            info.size = len(payload)
            archive.addfile(info, io.BytesIO(payload))
        notice_dir = self.directory / "notices"
        notice_dir.mkdir()
        for filename in licenses.FILES:
            (notice_dir / filename).write_text(f"content-{filename}\n", encoding="utf-8")

        real_open = licenses.tarfile.open
        seen_names = []

        def checking_open(name, mode="r", *args, **kwargs):
            seen_names.append((name, mode))
            self.assertIsInstance(name, str, "tarfile stream mode requires str paths on Python <= 3.12")
            return real_open(name, mode, *args, **kwargs)

        licenses.tarfile.open = checking_open
        try:
            licenses.attach(archive_path, notice_dir)
        finally:
            licenses.tarfile.open = real_open
        self.assertEqual(len(seen_names), 2)
        with tarfile.open(archive_path, "r:gz") as result:
            self.assertEqual(set(result.getnames()), {"rayu-linux-aarch64", *licenses.FILES})

    def test_draft_lookup_rejects_missing_or_duplicate_tag(self):
        original = verifier.subprocess.check_output
        self.addCleanup(setattr, verifier.subprocess, "check_output", original)
        for releases, message in (([], "No release"),
                                  ([{"tag_name": TAG}, {"tag_name": TAG}], "Multiple")):
            with self.subTest(message=message):
                verifier.subprocess.check_output = lambda args, r=releases: json.dumps(r).encode()
                with self.assertRaisesRegex(ValueError, message):
                    verifier.fetch_release_metadata("o/r", TAG, allow_draft=True)

    def test_windows_pe_portability_rejects_vcruntime_and_allows_static_crt(self):
        def build_minimal_pe64(dll_names):
            # Minimal PE32+ with 1 section (.rdata) at RVA 0x1000 / file offset 0x200.
            pe_offset = 0x80
            opt_size = 240  # PE32+ optional header with 16 data directories
            sec_rva = 0x1000
            sec_off = 0x200

            names_blob = bytearray()
            name_rvas = []
            desc_table_size = (len(dll_names) + 1) * 20
            for dll in dll_names:
                name_rvas.append(sec_rva + desc_table_size + len(names_blob))
                names_blob.extend(dll.encode("ascii") + b"\x00")

            rdata = bytearray()
            for name_rva in name_rvas:
                rdata.extend(struct.pack("<IIIII", 0, 0, 0, name_rva, 0))
            rdata.extend(b"\x00" * 20)
            rdata.extend(names_blob)

            buf = bytearray(sec_off + len(rdata))
            buf[0:2] = b"MZ"
            struct.pack_into("<I", buf, 0x3C, pe_offset)
            buf[pe_offset:pe_offset + 4] = b"PE\x00\x00"
            struct.pack_into("<HHIIIHH", buf, pe_offset + 4, 0x8664, 1, 0, 0, 0, opt_size, 0x22)
            opt_off = pe_offset + 24
            struct.pack_into("<H", buf, opt_off, 0x20B)  # PE32+
            # Import directory is DataDirectory[1] at opt_off + 112 + 8.
            struct.pack_into("<II", buf, opt_off + 112 + 8, sec_rva, desc_table_size)
            sec_hdr = opt_off + opt_size
            buf[sec_hdr:sec_hdr + 6] = b".rdata"
            struct.pack_into("<IIII", buf, sec_hdr + 8, len(rdata), sec_rva, len(rdata), sec_off)
            buf[sec_off:sec_off + len(rdata)] = rdata
            return bytes(buf)

        portable = self.directory / "rayu-static.exe"
        portable.write_bytes(build_minimal_pe64(["KERNEL32.dll", "bcrypt.dll", "api-ms-win-crt-runtime-l1-1-0.dll"]))
        self.assertEqual(
            verifier.verify_windows_pe_portable(portable),
            ["KERNEL32.dll", "bcrypt.dll", "api-ms-win-crt-runtime-l1-1-0.dll"],
        )

        dynamic = self.directory / "rayu-dynamic.exe"
        dynamic.write_bytes(build_minimal_pe64(["KERNEL32.dll", "VCRUNTIME140.dll"]))
        with self.assertRaisesRegex(ValueError, r"VCRUNTIME140\.dll"):
            verifier.verify_windows_pe_portable(dynamic)

        # Single source of truth: .cargo/config.toml sets +crt-static for Windows MSVC,
        # and Windows workflows enforce --check-windows-pe via this script.
        cargo_cfg = (ROOT / ".cargo/config.toml").read_text()
        self.assertIn('target-feature=+crt-static', cargo_cfg)
        for wf in ("release.yml", "ci.yml", "windows-smoke.yml"):
            self.assertIn("--check-windows-pe", (ROOT / ".github/workflows" / wf).read_text())


if __name__ == "__main__":
    unittest.main()
