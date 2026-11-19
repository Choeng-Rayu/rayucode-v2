#!/usr/bin/env python3
"""Verify a public release's complete asset set, provenance and downloaded hashes.

Uses authenticated gh CLI access. Reads archive members without installing them.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import os

PLATFORMS = ("linux-x86_64", "linux-aarch64", "macos-aarch64", "macos-x86_64",
             "windows-x86_64", "windows-aarch64", "freebsd-x86_64")
REQUIRED = {f"rayu-{platform}.tar.gz" for platform in PLATFORMS} | {
    "rayu-windows-x86_64.exe", "rayu-windows-aarch64.exe",
    "SHA256SUMS", "release-provenance.json",
}
TARGETS = dict(zip(PLATFORMS, (
    "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu", "aarch64-apple-darwin",
    "x86_64-apple-darwin", "x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc",
    "x86_64-unknown-freebsd",
)))


def verify_archive(path, standalone=None):
    platform = path.name.removeprefix("rayu-").removesuffix(".tar.gz")
    if platform not in TARGETS or path.name != f"rayu-{platform}.tar.gz":
        raise ValueError(f"Unrecognized release archive: {path.name}")
    binary = f"rayu-{platform}" + (".exe" if platform.startswith("windows-") else "")
    required = {"LICENSE", "THIRD_PARTY_NOTICES", "dependency-inventory.json", binary}
    optional = {binary + ".bin"} if platform == "linux-x86_64" else set()
    with tarfile.open(path, "r:gz") as archive:
        members = {}
        for member in archive:
            name = member.name.removeprefix("./")
            if (not member.isfile() or member.size == 0 or name in members
                    or name not in required | optional):
                raise ValueError(f"{path.name}: unexpected or unreviewed archive member {member.name}")
            members[name] = member
        if required - members.keys():
            raise ValueError(f"{path.name}: missing archive members {sorted(required - members.keys())}")
        if not members[binary].mode & 0o111 and not platform.startswith("windows-"):
            raise ValueError(f"{path.name}: runtime member is not executable")
        with archive.extractfile(members["LICENSE"]) as bundled_license:
            license_text = bundled_license.read()
        with archive.extractfile(members["THIRD_PARTY_NOTICES"]) as bundled_notices:
            notices = bundled_notices.read()
        with archive.extractfile(members["dependency-inventory.json"]) as bundled_inventory:
            inventory = json.load(bundled_inventory)
        if (b"Copyright (c) 2025 Jeremy Huang" not in license_text
                or b'THE SOFTWARE IS PROVIDED "AS IS"' not in license_text
                or b"Vendored Ratatui license" not in notices):
            raise ValueError(f"{path.name}: incomplete upstream notices")
        packages = inventory.get("packages")
        unresolved = inventory.get("unresolved_notices")
        if (inventory.get("format") != 1 or inventory.get("target") != TARGETS[platform]
                or not isinstance(packages, list) or not packages
                or not re.fullmatch(r"[0-9a-f]{64}", inventory.get("cargo_lock_sha256", ""))
                or not isinstance(unresolved, list)):
            raise ValueError(f"{path.name}: invalid dependency inventory")
        if unresolved:
            raise ValueError(f"{path.name}: missing verified dependency notices: {', '.join(unresolved)}")
        notice_blocks = re.split(
            r"(?m)^License text SHA-256: ([0-9a-f]{64})\n\n",
            notices.decode("utf-8").replace("\r\n", "\n"),
        )
        verified_texts = {
            digest for digest, contents in zip(notice_blocks[1::2], notice_blocks[2::2])
            if hashlib.sha256(contents.strip().encode()).hexdigest() == digest
        }
        for package in packages:
            if package.get("source") is None:
                continue
            evidence = package.get("notices")
            if not evidence or any(item["sha256"] not in verified_texts for item in evidence):
                raise ValueError(f"{path.name}: missing notice evidence for {package['name']}")
        if standalone is not None:
            standalone_bytes = standalone.read_bytes()
            with archive.extractfile(members[binary]) as executable:
                if hashlib.file_digest(executable, "sha256").digest() != hashlib.sha256(standalone_bytes).digest():
                    raise ValueError(f"{standalone.name}: standalone executable differs from archive")
            if notices not in standalone_bytes or license_text not in standalone_bytes:
                raise ValueError(f"{standalone.name}: standalone executable lacks embedded notices")


def verify_metadata(metadata, tag, allow_draft=False):
    if (metadata.get("tag_name") != tag or type(metadata.get("draft")) is not bool
            or (metadata["draft"] and not allow_draft)):
        raise ValueError("Release must be public and match the requested tag")
    if metadata.get("prerelease") is not False:
        raise ValueError("Official release must not be a prerelease")
    assets = metadata.get("assets", [])
    names = [asset.get("name") for asset in assets]
    if any(not isinstance(name, str) for name in names) or len(names) != len(set(names)):
        raise ValueError("Invalid or duplicate release asset names")
    missing = REQUIRED - set(names)
    if missing:
        raise ValueError(f"Missing required release assets: {sorted(missing)}")
    for asset in assets:
        if (Path(asset["name"]).name != asset["name"] or asset["name"] in {".", ".."}
                or "\\" in asset["name"] or asset.get("state") != "uploaded"
                or type(asset.get("size")) is not int or asset["size"] <= 0):
            raise ValueError("Release has unsafe, incomplete or empty assets")
    return set(names)


def verify_downloads(directory, names, tag, expected_sha, require_notices=False):
    directory = Path(directory)
    checksums = {}
    for line in (directory / "SHA256SUMS").read_text().splitlines():
        match = re.fullmatch(r"([0-9a-fA-F]{64}) [ *]([^/\\]+)", line)
        if not match or match[2] in checksums:
            raise ValueError("Malformed or duplicate checksum entry")
        checksums[match[2]] = match[1].lower()
    if set(checksums) != names - {"SHA256SUMS"}:
        raise ValueError("Checksum manifest must cover exactly the published assets")
    for name in names:
        path = directory / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size == 0:
            raise ValueError(f"Missing or unsafe downloaded asset: {name}")
        if name != "SHA256SUMS":
            with path.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            if digest != checksums[name]:
                raise ValueError(f"Checksum mismatch: {name}")
    provenance = json.loads((directory / "release-provenance.json").read_text())
    if (provenance.get("tag") != tag or provenance.get("tag_commit") != expected_sha
            or provenance.get("repair") != "none"
            or provenance.get("eligibility_policy") != "exact-sha-main-ci"):
        raise ValueError("Release provenance does not match the validated unpatched commit")
    if require_notices:
        for platform in PLATFORMS:
            standalone = directory / f"rayu-{platform}.exe" if platform.startswith("windows-") else None
            verify_archive(directory / f"rayu-{platform}.tar.gz", standalone)


def fetch_release_metadata(repo, tag, allow_draft=False):
    """Return release metadata for `tag`.

    GitHub's `releases/tags/{tag}` endpoint only resolves published releases
    and returns 404 for drafts, so staged-draft verification must search the
    authenticated release list instead.
    """
    if not allow_draft:
        return json.loads(subprocess.check_output(
            ["gh", "api", f"repos/{repo}/releases/tags/{tag}"]))
    page = 1
    while True:
        releases = json.loads(subprocess.check_output(
            ["gh", "api", f"repos/{repo}/releases?per_page=100&page={page}"]))
        matches = [release for release in releases if release.get("tag_name") == tag]
        if len(matches) > 1:
            raise ValueError(f"Multiple releases claim tag {tag}")
        if matches:
            return matches[0]
        if len(releases) < 100:
            raise ValueError(f"No release found for tag {tag}")
        page += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag", nargs="?")
    parser.add_argument("--repo", default="Choeng-Rayu/rayucode")
    parser.add_argument("--sha", help="Validated exact tag commit")
    parser.add_argument("--allow-draft", action="store_true",
                        help="Validate staged draft assets before publication")
    parser.add_argument("--require-notices", action="store_true",
                        help="Verify license files, inventories and standalone notices")
    parser.add_argument("--check-archive", type=Path,
                        help="Validate a local release archive without downloading it")
    parser.add_argument("--directory", help="Keep downloads in this new directory")
    args = parser.parse_args()
    if args.check_archive:
        verify_archive(args.check_archive)
        return
    if not args.tag or not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", args.tag):
        parser.error("tag must be vMAJOR.MINOR.PATCH")
    if not args.sha or not re.fullmatch(r"[0-9a-f]{40}", args.sha):
        parser.error("sha must be a full lowercase commit SHA")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*", args.repo):
        parser.error("repo must be OWNER/REPO")
    metadata = fetch_release_metadata(args.repo, args.tag, allow_draft=args.allow_draft)
    names = verify_metadata(metadata, args.tag, allow_draft=args.allow_draft)

    def download_and_verify(directory):
        subprocess.run(["gh", "release", "download", args.tag, "--repo", args.repo,
                        "--dir", str(directory)], check=True)
        verify_downloads(directory, names, args.tag, args.sha, args.require_notices)
        state = "draft" if metadata["draft"] else "public"
        print(f"VERIFIED: {args.tag}, {len(names)} {state} assets, exact provenance and SHA256 hashes")

    if args.directory:
        directory = Path(args.directory)
        directory.mkdir(parents=True, exist_ok=False)
        download_and_verify(directory)
    else:
        with tempfile.TemporaryDirectory(dir=os.environ.get("RAYU_SCRATCH_DIR")) as directory:
            download_and_verify(directory)


if __name__ == "__main__":
    main()
