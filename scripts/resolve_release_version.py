#!/usr/bin/env python3
"""Resolve the next release tag and metadata for .github/workflows/release.yml.

Supports three triggers:
1. Push / PR merge to `main`:
   - Skips when commit message contains `[skip release]` or `[no release]`.
   - Skips when HEAD already carries a stable `vMAJOR.MINOR.PATCH` tag.
   - Honors a manual minor/major bump in Cargo.toml when strictly newer than the
     highest stable tag; otherwise auto-bumps the patch version (v3.0.0 -> v3.0.1).
2. Explicit stable tag push (`refs/tags/vMAJOR.MINOR.PATCH`).
3. Manual `workflow_dispatch` (either rebuilding an existing `tag` input, or
   auto-resolving the next release for `main` when `tag` is omitted).
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys
import tomllib

STABLE_TAG_RE = re.compile(r"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
SKIP_MARKER_RE = re.compile(r"\[(skip release|no release)\]", re.IGNORECASE)


def parse_stable_tag(tag: str) -> tuple[int, int, int] | None:
    match = STABLE_TAG_RE.fullmatch(tag.strip())
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)))


def parse_cargo_version(cargo_toml_text: str) -> tuple[int, int, int]:
    raw = tomllib.loads(cargo_toml_text)["package"]["version"].strip()
    parsed = parse_stable_tag(f"v{raw}")
    if parsed is None:
        raise ValueError(f"Invalid Cargo.toml [package].version: {raw!r} (expected MAJOR.MINOR.PATCH)")
    return parsed


def highest_stable_tag(tags: list[str]) -> tuple[tuple[int, int, int], str] | None:
    best: tuple[tuple[int, int, int], str] | None = None
    for tag in tags:
        parsed = parse_stable_tag(tag)
        if parsed is None:
            continue
        if best is None or parsed > best[0]:
            best = (parsed, tag.strip())
    return best


def compute_next_main_release(
    *,
    cargo_version: tuple[int, int, int],
    all_tags: list[str],
    head_tags: list[str],
    commit_message: str,
    head_sha: str,
    allow_already_tagged: bool = False,
) -> dict[str, str]:
    if SKIP_MARKER_RE.search(commit_message or ""):
        return {
            "should_release": "false",
            "reason": "Commit message contains [skip release] / [no release]",
            "release_tag": "",
            "prev_tag": "",
            "tag_sha": head_sha,
            "create_tag": "false",
        }

    existing_head = highest_stable_tag(head_tags)
    if existing_head is not None and not allow_already_tagged:
        return {
            "should_release": "false",
            "reason": f"Commit {head_sha[:7]} already has stable release tag {existing_head[1]}",
            "release_tag": existing_head[1],
            "prev_tag": "",
            "tag_sha": head_sha,
            "create_tag": "false",
        }

    latest = highest_stable_tag(all_tags)
    prev_tag = latest[1] if latest is not None else ""
    if latest is None or cargo_version > latest[0]:
        next_semver = cargo_version
    else:
        major, minor, patch = latest[0]
        next_semver = (major, minor, patch + 1)

    next_tag = f"v{next_semver[0]}.{next_semver[1]}.{next_semver[2]}"
    return {
        "should_release": "true",
        "reason": f"Auto-releasing {next_tag} from main ({head_sha[:7]})",
        "release_tag": next_tag,
        "prev_tag": prev_tag,
        "tag_sha": head_sha,
        "create_tag": "true",
    }


def git_output(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=repo, text=True).strip()


def resolve_from_repo(
    repo: Path,
    *,
    event_name: str,
    ref: str,
    ref_name: str,
    sha: str,
    input_tag: str,
) -> dict[str, str]:
    all_tags = [line for line in git_output(repo, "tag", "-l", "v*").splitlines() if line.strip()]
    input_tag = input_tag.strip()

    # Case 1: explicit tag push OR workflow_dispatch with an explicit tag input
    if (event_name == "push" and ref.startswith("refs/tags/")) or (
        event_name == "workflow_dispatch" and input_tag
    ):
        target_tag = input_tag if input_tag else ref_name
        parsed = parse_stable_tag(target_tag)
        if parsed is None:
            raise ValueError(f"Invalid release tag {target_tag!r} (expected vMAJOR.MINOR.PATCH)")
        tag_sha = git_output(repo, "rev-parse", "--verify", f"refs/tags/{target_tag}^{{commit}}")
        if event_name == "push" and sha and tag_sha != sha:
            raise ValueError(f"Tag {target_tag} ({tag_sha}) does not match triggering commit ({sha})")
        older_tags = [
            t for t in all_tags if (p := parse_stable_tag(t)) is not None and p < parsed
        ]
        prev = highest_stable_tag(older_tags)
        return {
            "should_release": "true",
            "reason": f"Releasing existing tag {target_tag} at {tag_sha[:7]}",
            "release_tag": target_tag,
            "prev_tag": prev[1] if prev is not None else "",
            "tag_sha": tag_sha,
            "create_tag": "false",
        }

    # Case 2: push/merge to main, or workflow_dispatch on main with empty tag input
    if ref != "refs/heads/main":
        return {
            "should_release": "false",
            "reason": f"Skipping release for non-main ref {ref!r}",
            "release_tag": "",
            "prev_tag": "",
            "tag_sha": sha,
            "create_tag": "false",
        }

    head_sha = git_output(repo, "rev-parse", "HEAD")
    head_tags = [
        line
        for line in git_output(repo, "tag", "--points-at", head_sha, "v*").splitlines()
        if line.strip()
    ]
    commit_message = git_output(repo, "log", "-1", "--format=%B", head_sha)
    cargo_version = parse_cargo_version((repo / "Cargo.toml").read_text(encoding="utf-8"))
    return compute_next_main_release(
        cargo_version=cargo_version,
        all_tags=all_tags,
        head_tags=head_tags,
        commit_message=commit_message,
        head_sha=head_sha,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--event", default=os.environ.get("GITHUB_EVENT_NAME", ""))
    parser.add_argument("--ref", default=os.environ.get("GITHUB_REF", ""))
    parser.add_argument("--ref-name", default=os.environ.get("GITHUB_REF_NAME", ""))
    parser.add_argument("--sha", default=os.environ.get("GITHUB_SHA", ""))
    parser.add_argument("--input-tag", default=os.environ.get("INPUT_TAG", ""))
    parser.add_argument("--github-output", type=Path, default=None)
    args = parser.parse_args()

    result = resolve_from_repo(
        args.repo,
        event_name=args.event,
        ref=args.ref,
        ref_name=args.ref_name,
        sha=args.sha,
        input_tag=args.input_tag,
    )
    for key, value in result.items():
        print(f"{key}={value}")
    if args.github_output is not None:
        with args.github_output.open("a", encoding="utf-8") as fh:
            for key, value in result.items():
                fh.write(f"{key}={value}\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"::error::{exc}", file=sys.stderr)
        raise SystemExit(1)
