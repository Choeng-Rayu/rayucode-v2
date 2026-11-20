#!/usr/bin/env python3
"""Generate and package target-specific license notices and dependency inventories."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile


ROOT = Path(__file__).resolve().parents[1]
FILES = ("LICENSE", "THIRD_PARTY_NOTICES", "dependency-inventory.json")
NOTICE_NAME = re.compile(r"^(licen[cs]e|copying|copyright|notice|unlicense)([-_.]|$)", re.I)
ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
SUPPLEMENTS = ROOT / "packaging/dependency-licenses"


def read_cargo_graph(args):
    cargo_args = ["--locked", "--color=never"]
    if args.offline:
        cargo_args.append("--offline")
    if args.no_default_features:
        cargo_args.append("--no-default-features")
    if args.features:
        cargo_args.extend(["--features", args.features])
    env = {**os.environ, "CARGO_TERM_COLOR": "never"}
    metadata = json.loads(subprocess.check_output([
        "cargo", "metadata", "--format-version", "1", "--filter-platform",
        args.target, *cargo_args,
    ], cwd=ROOT, env=env))
    # Use the root package's actual normal/build graph. Workspace-wide metadata
    # also contains packages enabled solely by other members or dev targets.
    tree = subprocess.check_output([
        "cargo", "tree", "-p", "rayucode", "--target", args.target,
        "--edges", "normal,build", "--prefix", "none", "--format", "{p}",
        *cargo_args,
    ], cwd=ROOT, env=env, text=True)
    return metadata["packages"], {
        ANSI_ESCAPE.sub("", line).strip().removesuffix(" (*)")
        for line in tree.splitlines()
        if line.strip()
    }


def selected_packages(args):
    packages, tree = read_cargo_graph(args)
    selected = []
    for package in packages:
        name = f"{package['name']} v{package['version']}"
        source = package["source"]
        path = Path(package["manifest_path"]).parent
        labels = [name]
        if source and source.startswith("git+"):
            url, revision = source.removeprefix("git+").rsplit("#", 1)
            labels.append(f"{name} ({url}#{revision[:8]})")
        if source is None:
            labels = [f"{name} ({path})", f"{name} ({path.as_posix()})"]
        if not tree.intersection(labels):
            # Cargo can render platform-specific path separators or shorten
            # source URLs. Registry and git packages are still disambiguated
            # by their source when several versions have the same name.
            matching = [label for label in tree if label == name or label.startswith(name + " (")]
            if not matching:
                continue
            if sum(p["name"] == package["name"] and p["version"] == package["version"]
                   for p in packages) != 1:
                raise ValueError(f"ambiguous Cargo dependency {name}")
        selected.append(package)
    if not selected or len(selected) != len(tree - {"[build-dependencies]"}):
        raise ValueError("could not match Cargo tree entries to the resolved package metadata")
    return sorted(selected, key=lambda p: (p["name"], p["version"], p["source"] or ""))


def license_paths(package):
    package_dir = Path(package["manifest_path"]).parent
    files = {path for path in package_dir.iterdir() if path.is_file() and NOTICE_NAME.match(path.name)}
    if package["license_file"]:
        files.add(package_dir / package["license_file"])
    for path in package_dir.iterdir():
        if path.is_dir() and path.name.lower() in ("licenses", "license", "licences"):
            files.update(file for file in path.rglob("*") if file.is_file())
    if package["source"] and package["source"].startswith("git+"):
        root = Path(subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], cwd=package_dir, text=True,
        ).strip())
        files.update(path for path in root.iterdir() if path.is_file() and NOTICE_NAME.match(path.name))
    for bundled_sources in ("aws-lc", "quickjs", "openssl", "vendor"):
        subtree = package_dir / bundled_sources
        if subtree.is_dir():
            files.update(path for path in subtree.rglob("*") if path.is_file() and NOTICE_NAME.match(path.name))
    return sorted(path for path in files if path.is_file())


def generate(args):
    packages = selected_packages(args)
    chunks = [(ROOT / "THIRD_PARTY_NOTICES").read_text(encoding="utf-8").strip()]
    evidence = {}
    inventory = []
    unresolved = []
    supplements = json.loads((SUPPLEMENTS / "sources.json").read_text(encoding="utf-8"))
    for package in packages:
        name, version = package["name"], package["version"]
        source = package["source"]
        entry = {"name": name, "version": version, "source": source,
                 "license": package["license"], "notices": []}
        inventory.append(entry)
        if source is None:
            entry["path"] = Path(package["manifest_path"]).parent.relative_to(ROOT).as_posix()
            continue
        paths = [(path, None) for path in license_paths(package)]
        paths.extend((SUPPLEMENTS / item["file"], item["url"])
                     for item in supplements.get(f"{name} {version}", []))
        for path, url in paths:
            contents = path.read_text(encoding="utf-8", errors="replace").strip()
            if not contents:
                continue
            digest = hashlib.sha256(contents.encode()).hexdigest()
            evidence.setdefault(digest, contents)
            record = {"file": path.name, "sha256": digest}
            if url:
                record["url"] = url
            entry["notices"].append(record)
        if not entry["notices"]:
            unresolved.append(f"{name} {version}")
        else:
            locations = ", ".join(file["sha256"] for file in entry["notices"])
            upstream = "".join(f"\nUpstream notice: {file['url']}"
                               for file in entry["notices"] if "url" in file)
            chunks.append(f"{name} {version} ({entry['license'] or 'see notice'})\n"
                          f"Source: {source}\nNotice SHA-256: {locations}{upstream}")
    for digest, contents in evidence.items():
        chunks.append(f"License text SHA-256: {digest}\n\n{contents}")
    if unresolved:
        chunks.append("Packages requiring upstream notice review\n\n" + "\n".join(unresolved))
    report = {
        "format": 1,
        "target": args.target,
        "default_features": not args.no_default_features,
        "features": sorted(set(filter(None, re.split(r"[\s,]+", args.features or "")))),
        "cargo_lock_sha256": hashlib.sha256((ROOT / "Cargo.lock").read_bytes()).hexdigest(),
        "packages": inventory,
        "unresolved_notices": unresolved,
    }
    args.directory.mkdir(parents=True, exist_ok=True)
    (args.directory / FILES[0]).write_bytes((ROOT / "LICENSE").read_bytes())
    (args.directory / FILES[1]).write_text("\n\n".join(chunks) + "\n", encoding="utf-8")
    (args.directory / FILES[2]).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"{args.target}: {len(inventory)} packages, {len(unresolved)} unresolved notices")


def attach(archive, directory):
    """Add package notices atomically while preserving original archive members."""
    with tempfile.TemporaryDirectory(dir=archive.parent) as temp:
        staged = Path(temp) / archive.name
        with tarfile.open(archive, "r|gz") as source, tarfile.open(staged, "w|gz") as dest:
            for member in source:
                if member.name.removeprefix("./") in FILES:
                    continue
                dest.addfile(member, source.extractfile(member) if member.isfile() else None)
            for filename in FILES:
                dest.add(directory / filename, arcname=filename)
        staged.replace(archive)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    generator = sub.add_parser("generate")
    generator.add_argument("target")
    generator.add_argument("directory", type=Path)
    generator.add_argument("--features")
    generator.add_argument("--no-default-features", action="store_true")
    generator.add_argument("--offline", action="store_true")
    packaging = sub.add_parser("attach")
    packaging.add_argument("archive", type=Path)
    packaging.add_argument("directory", type=Path)
    args = parser.parse_args()
    if args.command == "generate":
        generate(args)
    else:
        attach(args.archive, args.directory)


if __name__ == "__main__":
    main()
