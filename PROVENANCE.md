# RayuCode release provenance

RayuCode v2 uses [Jcode at `02152f3a188d2799de0856ebfc5d16dc4ce261f8`](https://github.com/1jehuang/jcode/tree/02152f3a188d2799de0856ebfc5d16dc4ce261f8)
as its Rust base. Retain the upstream history and [MIT license](LICENSE).
Vendored Ratatui has its own [license](vendor/ratatui-rayucode/LICENSE).

The Rayu authentication, hosted-model runtime, onboarding, branding, and
distribution changes are the local delta. Review that delta against the pinned
base, recording the source and redistribution rights of imported material before
cutting a release. The README mark and macOS icon were encoded from the
workspace's `Rayu-Logo/RayuCode Logo.png`. Confirm ownership or redistribution
permission for that artwork and the media published on the product site.

Use the older TypeScript Rayu product as a workflow reference. Review any
proposed source, prompt, fixture, asset, or VSIX reuse separately against its
origin manifest and applicable rights. The Rust release builds from this
workspace.

Release review covers generated and bundled files, native libraries, and
optional downloads such as the browser bridge. Check the target dependency
inventories and resolve each dependency whose checkout omits its notices.
Record the exact source revision and required license and copyright material
before including supplemental notices in a release.

The pinned trees for `agentgrep 0.2.0` and several PDF dependencies lack a
standalone license or copyright file. The Cargo manifests identify license
terms. Obtain the corresponding notice material from upstream or replace the
affected dependencies before packaging for release. The
[objc2 upstream license note](https://github.com/madsmtm/objc2/blob/7b1abfd750a2cacaea71d6a56ecfb83cb7de560b/LICENSE.md)
also calls out licensing questions about bindings derived from Apple SDKs.
Review those bindings before releasing the macOS builds.

Paid hosted inference has a separate launch gate. Verify the live gateway's
credit ledger for completed, failed, cancelled, and retried requests in
staging. Match enabled routes to the actual provider agreements, then confirm
the seller, first markets, pricing, credit and refund terms, and privacy terms
before opening checkout.
