# Spec 07 — Changes, Native VS Code Diffs & PR Guardrail

> **Desktop Reference:** `desktop/src/features/changes/components/changes-view.tsx`, `desktop/src/features/changes/components/diff-panel.tsx`.
> **VS Code Native Helpers Reused:** `vscode/host/review/reversePatch.ts`, `vscode/host/review/reviewUri.ts`, `vscode.diff` (`ViewColumn.Beside`).
> **Owned Files (Wave 3F — Part 1):** `vscode/webview/src/features/changes/**`.

---

## 1. Visual Layout — Desktop Parity + Native VS Code Editor Integration

### Top Header (`h-auto border-b border-hairline bg-canvas px-5 py-2.5 flex flex-wrap items-center gap-3`)
1. `GitBranch` icon (`text-brand-text`) + monospace branch name (`changes.branch`)
2. `N changed files` pill (`rounded-full border border-hairline bg-pane px-2.5 py-0.5 font-mono text-[11px] tabular-nums`)
3. Diff totals (`+additions` in `text-brand-text`, `−deletions` in `text-danger`, `tabular-nums`)
4. Scope toggle pills: **`Session Edits`** (exact files modified by Rayu in this session) | **`All Git Changes`** (full workspace working tree via `GitChangesBridge`)
5. Right-aligned actions:
   - `Unified | Split` Radix `Tabs` (visible in Wide `>= 960px`; Compact defaults cleanly to `Unified` or native `vscode.diff`)
   - **`[Open Diff in VS Code]`** (opens selected file's side-by-side `vscode.diff` in `ViewColumn.Beside` without replacing the chat tab!)
   - **`[Create PR]`** primary guardrail button.

### Body Layout
- **Wide (`>= 960px`):** Two-column split — Left flat changed-files list (`w-[310px] border-r border-hairline`) with sticky bottom Commit Form + Right syntax-highlighted `DiffPanel` (`shiki`).
- **Compact Sidebar (`< 560px`):** Flat changed-files list takes 100% width! Clicking a file row **immediately opens native `vscode.diff` in the adjacent VS Code editor group** (the most natural IDE workflow!), with a tiny `Preview inline ⌄` chevron if the user wants to peek at hunks inside the sidebar without leaving focus.

---

## 2. Exact Desktop Component Contracts

1. **`FlatChangedFileRow` (No Folder Tree in v1 — Single Flat List):**
   - Stage checkbox (`role="checkbox"`, `size-4 rounded-[4px]`, `border-brand bg-brand text-brand-ink` when staged)
   - `<TechFileBadge path={file.path} />` + truncated monospace path + `+A −R` tabular stats
   - Metadata row: `ownerBadge` pill (e.g. `worker-2` or `session` or `M`/`A`/`D`/`?`), plus `Accepted` (`bg-brand-soft text-brand-text`) or `Rejected` (`bg-danger-soft text-danger`) decision pill.
   - Quick hover actions: `Open File` (jumps to editor), `Open Diff` (`vscode.diff`), `Keep` / `Undo` (uses pre-edit `ReviewStore` snapshot + `reversePatch.ts` with stale-edit safety — refuses to clobber manual edits made by the user after Rayu edited the file!).
2. **Inline Commit Box (Bottom of Left Rail):**
   - `[Stage all / Unstage all]` toggle + conventional commit input (`feat(vscode): ...`) + `[Commit N staged]` primary button (`gitChangesBridge.commitStaged`). Shows quiet commit hash confirmation on success.
3. **`DiffPanel` (Wide Right Pane):**
   - File header with `<TechFileBadge />`, full path, `+A −R`, `[Open File]`, `[Open in VS Code Diff]`, `[Reject / Undo]`, `[Accept / Keep]`.
   - Syntax-highlighted Unified or Split diff using `--diff-add-bg`, `--diff-del-bg`, `--diff-add-rail`, `--diff-del-rail`, `tabular-nums` gutter line numbers, and `bg-inset` well.
4. **Explicit `Create PR` Approval Guardrail (`Dialog`):**
   - Opening the dialog NEVER pushes or runs `gh` automatically.
   - Displays a clear amber `ShieldAlert` guardrail notice (*"Review branch, commits, and files below before creating a pull request."*), editable `Base branch`, `Head branch` (read-only), `PR Title`, `PR Summary`, included file list, and `[Cancel]` + **`[Confirm & Create PR]`** primary CTA.
