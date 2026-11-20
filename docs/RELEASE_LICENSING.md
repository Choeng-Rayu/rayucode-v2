# Release licensing: unresolved third-party notices

`scripts/release_licenses.py` records every Cargo dependency in
`dependency-inventory.json`. A dependency whose crate/repo ships no licence file
is listed in `unresolved_notices`, and `scripts/verify_public_release.py
--check-archive` rejects any archive that has a non-empty list.

## Effect per pipeline

| Pipeline | Runs `--check-archive` | Blocked by unresolved notices |
|---|---|---|
| `release.yml` (public closed-source release) | **no** | **no** — v3.0.0 is unaffected |
| `preview.yml` (`native-arm-runtime` / hosted previews) | yes | yes |
| `scripts/prepare_sdk_runtime_packages.sh` | yes | yes |

`release.yml` only runs `release_licenses.py generate` + `attach`, which still
embed the inventory and the "Packages requiring upstream notice review" section,
so the shipped archive is transparent about what is unresolved.

## Current state (target `x86_64-unknown-linux-gnu`, v3.0.0)

The build starts with six unresolved packages. `fax` and `fax_derive` are now
resolved through `sources.json`, so **four remain**. Each declares
`license = "MIT"`, but the crate tarball and the upstream repository both lack a
licence file, so there is no attribution text to record:

| Package | Version | Upstream repo | Licence field | Licence file upstream |
|---|---|---|---|---|
| adobe-cmap-parser | 0.4.1 | jrmuizel/adobe-cmap-parser | MIT | none in repo |
| pdf-extract | 0.12.0 | jrmuizel/pdf-extract | MIT | none in repo |
| type1-encoding-parser | 0.1.1 | jrmuizel/type1-encoding-parser | MIT | none in repo |
| agentgrep | 0.2.0 | 1jehuang/agentgrep (git dep, tag v0.2.0) | MIT | not published to crates.io |

Resolved: `fax 0.2.6` and `fax_derive 0.2.0` share the pinned `pdf-rs/fax`
`LICENSE` (real MIT text, "Copyright © 2021 The pdf-rs contributors"), recorded in
`sources.json` against commit `4de57f7a`.

Do **not** synthesise MIT text for the four above: inventing a copyright line for
someone else's code is a worse problem than an honest "needs review" entry. The
MIT body is already present in the notices from other MIT dependencies, so only
the attribution is missing.

## How to resolve

`sources.json` in this directory maps `"<name> <version>"` to notice files plus
the upstream URL they were taken from. `release_licenses.py generate` appends
them automatically, which clears the package from `unresolved_notices`.

1. Add the upstream licence file to this directory, named by the SHA-256 of its
   contents (the existing files follow that convention).
2. Add a `sources.json` entry pointing at the file and its pinned upstream URL.
3. Re-run `python3 scripts/release_licenses.py generate <target> <dir>` and check
   the reported unresolved count drops.

For the four remaining packages the correct fix is to ask the authors to add a
licence file (or confirm the attribution text to use) and then record it here
with that confirmation as the source.
