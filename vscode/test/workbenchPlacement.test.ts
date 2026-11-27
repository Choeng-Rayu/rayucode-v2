import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import {
  ComposerInjectionPayloadSchema,
  type HostToWebviewMessage,
} from "../shared/vscodeProtocol.js";
import {
  buildDiagnosticInjection,
  selectRelevantDiagnostics,
  type DiagnosticLike,
} from "../host/bridges/codeActionBridge.js";
import {
  buildFilePathCandidates,
  normalizeBrowserUrl,
  rankWorkspaceFileMatches,
  resolveTargetCodeColumn,
  sanitizeFileOpenTarget,
} from "../host/bridges/editorBridge.js";
import {
  buildTerminalInjection,
  stripAnsiCodes,
} from "../host/bridges/terminalBridge.js";
import { SurfaceCommandQueue } from "../host/panel/workspacePanelManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, "../extension.manifest.json");
const ASSETS_DIR = path.resolve(__dirname, "../assets");
const ICON_ASSETS_MODULE_URL = pathToFileURL(
  path.resolve(__dirname, "../scripts/generate-icon-assets.mjs"),
).href;

function extractWoffTable(woff: Buffer, targetTag: string): Buffer | null {
  const numTables = woff.readUInt16BE(12);
  for (let i = 0; i < numTables; i += 1) {
    const recOff = 44 + i * 20;
    const tag = woff.subarray(recOff, recOff + 4).toString("ascii");
    if (tag !== targetTag) continue;
    const offset = woff.readUInt32BE(recOff + 4);
    const compLength = woff.readUInt32BE(recOff + 8);
    const origLength = woff.readUInt32BE(recOff + 12);
    const slice = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(slice) : slice;
    assert.equal(data.length, origLength, `${targetTag} decompressed length`);
    return data;
  }
  return null;
}

test("buildRayuIconWoff produces valid WOFF 1.0 + TrueType SFNT tables and Rayu Fox assets", async () => {
  const { RAYU_ICON_CODEPOINT, buildRayuIconWoff } = (await import(
    ICON_ASSETS_MODULE_URL,
  )) as {
    RAYU_ICON_CODEPOINT: number;
    buildRayuIconWoff: () => Buffer;
  };
  const woff = buildRayuIconWoff();
  assert.ok(Buffer.isBuffer(woff));
  assert.ok(woff.length > 100);

  // WOFF 1.0 magic 'wOFF' (0x774F4646) & TrueType flavor (0x00010000)
  assert.equal(woff.readUInt32BE(0), 0x774f4646);
  assert.equal(woff.readUInt32BE(4), 0x00010000);
  assert.equal(woff.readUInt32BE(8), woff.length);

  // 10 SFNT tables, strictly sorted by ASCII tag
  const numTables = woff.readUInt16BE(12);
  assert.equal(numTables, 10);
  const tags: string[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const recOff = 44 + i * 20;
    tags.push(woff.subarray(recOff, recOff + 4).toString("ascii"));
  }
  const sortedTags = [...tags].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(tags, sortedTags);
  assert.deepEqual(tags, [
    "OS/2",
    "cmap",
    "glyf",
    "head",
    "hhea",
    "hmtx",
    "loca",
    "maxp",
    "name",
    "post",
  ]);

  // head table magicNumber === 0x5F0F3CF5
  const head = extractWoffTable(woff, "head");
  assert.ok(head, "head table missing");
  assert.equal(head.readUInt32BE(12), 0x5f0f3cf5);

  // cmap format 4 maps 0xEA01 -> glyph 1
  const cmap = extractWoffTable(woff, "cmap");
  assert.ok(cmap, "cmap table missing");
  const numEncodings = cmap.readUInt16BE(2);
  assert.ok(numEncodings >= 1);
  const subtableOffset = cmap.readUInt32BE(8);
  const format = cmap.readUInt16BE(subtableOffset);
  assert.equal(format, 4);
  const segCount = cmap.readUInt16BE(subtableOffset + 6) / 2;
  assert.ok(segCount >= 2);
  const endCodeOffset = subtableOffset + 14;
  const startCodeOffset = endCodeOffset + segCount * 2 + 2; // + reservedPad
  const idDeltaOffset = startCodeOffset + segCount * 2;
  const firstEnd = cmap.readUInt16BE(endCodeOffset);
  const firstStart = cmap.readUInt16BE(startCodeOffset);
  const firstDelta = cmap.readUInt16BE(idDeltaOffset);
  assert.equal(RAYU_ICON_CODEPOINT, 0xea01);
  assert.equal(firstStart, 0xea01);
  assert.equal(firstEnd, 0xea01);
  assert.equal((0xea01 + firstDelta) & 0xffff, 1);

  // Rayu Fox sidebar SVG exists, uses solid #6D28D9 fill (zero currentColor), and old cat icon.svg is absent
  const foxSvgPath = path.join(ASSETS_DIR, "rayu-fox-icon.svg");
  assert.equal(fs.existsSync(foxSvgPath), true, "assets/rayu-fox-icon.svg must exist");
  const foxSvg = fs.readFileSync(foxSvgPath, "utf8");
  assert.match(foxSvg, /fill="#6D28D9"/i);
  assert.equal(foxSvg.includes("currentColor"), false);
  assert.equal(
    fs.existsSync(path.join(ASSETS_DIR, "icon.svg")),
    false,
    "legacy cat assets/icon.svg must not exist",
  );

  // Rayu Fox PNG exists and starts with valid PNG magic bytes
  const foxPngPath = path.join(ASSETS_DIR, "rayu-fox.png");
  assert.equal(fs.existsSync(foxPngPath), true, "assets/rayu-fox.png must exist");
  const pngHeader = fs.readFileSync(foxPngPath).subarray(0, 8);
  assert.deepEqual(
    pngHeader,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
});

test("SurfaceCommandQueue buffers cold-start commands, expires TTL, caps size, and isolates per-surface delivery", () => {
  let fakeNow = 10_000;
  const queue = new SurfaceCommandQueue<HostToWebviewMessage>({
    maxPerSurface: 10,
    ttlMs: 15_000,
    now: () => fakeNow,
  });

  const delivered: Array<{ surfaceId: string; msg: HostToWebviewMessage }> = [];
  const deliver = (surfaceId: string, msg: HostToWebviewMessage): boolean => {
    delivered.push({ surfaceId, msg });
    return true;
  };

  const cmdA: HostToWebviewMessage = {
    type: "rayucode.host.command",
    command: "newSession",
  };
  const cmdB: HostToWebviewMessage = {
    type: "rayucode.composer.inject",
    injection: {
      id: "inj_1",
      mentions: ["src/app.ts"],
      autoSubmit: false,
    },
  };

  // Cold sidebar buffers commands instead of dropping or broadcasting
  assert.equal(queue.dispatch("sidebar-main", cmdA, deliver), "queued");
  assert.equal(queue.dispatch("sidebar-main", cmdB, deliver), "queued");
  assert.equal(delivered.length, 0);
  assert.equal(queue.pendingCount("sidebar-main"), 2);
  assert.equal(queue.pendingCount("editor-panel-main"), 0);

  // Another surface becoming ready MUST NOT receive sidebar-main's queued commands
  assert.deepEqual(queue.markReady("editor-panel-main"), []);
  assert.equal(queue.pendingCount("sidebar-main"), 2);

  // Ready sidebar flushes in FIFO order
  const flushed = queue.markReady("sidebar-main");
  assert.deepEqual(flushed, [cmdA, cmdB]);
  assert.equal(queue.pendingCount("sidebar-main"), 0);

  // Subsequent dispatch to ready sidebar delivers ONLY to sidebar-main
  const cmdC: HostToWebviewMessage = {
    type: "rayucode.host.command",
    command: "resumeSession",
  };
  assert.equal(queue.dispatch("sidebar-main", cmdC, deliver), "delivered");
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.surfaceId, "sidebar-main");
  assert.deepEqual(delivered[0]?.msg, cmdC);

  // Dispose marks surface not ready again; TTL expiry drops stale entries
  queue.markDisposed("sidebar-main");
  queue.dispatch("sidebar-main", cmdA, deliver);
  fakeNow += 10_000;
  queue.dispatch("sidebar-main", cmdB, deliver);
  fakeNow += 6_000; // cmdA is now 16s old (expired), cmdB is 6s old (fresh)
  assert.equal(queue.pendingCount("sidebar-main"), 1);
  assert.deepEqual(queue.markReady("sidebar-main"), [cmdB]);

  // Bounded capacity: queueing 12 messages keeps latest 10
  queue.markDisposed("editor-panel-main");
  for (let i = 1; i <= 12; i += 1) {
    queue.dispatch(
      "editor-panel-main",
      { type: "rayucode.host.command", command: `cmd_${i}` },
      deliver,
    );
  }
  const capped = queue.markReady("editor-panel-main");
  assert.equal(capped.length, 10);
  assert.deepEqual(
    capped.map((m) => (m.type === "rayucode.host.command" ? m.command : "")),
    [
      "cmd_3",
      "cmd_4",
      "cmd_5",
      "cmd_6",
      "cmd_7",
      "cmd_8",
      "cmd_9",
      "cmd_10",
      "cmd_11",
      "cmd_12",
    ],
  );
});

test("selectRelevantDiagnostics and buildDiagnosticInjection prioritize, deduplicate, cap, and bound snippets", () => {
  assert.deepEqual(selectRelevantDiagnostics([]), []);

  // Only Hints -> empty; Info fallback works when no Errors/Warnings exist
  const hintsOnly: DiagnosticLike[] = [
    {
      message: "Unused import",
      severity: 3,
      range: { start: { line: 0 }, end: { line: 0 } },
    },
  ];
  assert.deepEqual(selectRelevantDiagnostics(hintsOnly), []);

  const infoAndHint: DiagnosticLike[] = [
    ...hintsOnly,
    {
      message: "Consider simplifying expression",
      severity: 2,
      source: "eslint",
      range: { start: { line: 4 }, end: { line: 4 } },
    },
  ];
  const infoPicked = selectRelevantDiagnostics(infoAndHint);
  assert.equal(infoPicked.length, 1);
  assert.equal(infoPicked[0]?.message, "Consider simplifying expression");

  // Mixed severities + duplicates + > 5 diagnostics
  const mixed: DiagnosticLike[] = [
    {
      message: "Info note",
      severity: 2,
      range: { start: { line: 1 }, end: { line: 1 } },
    },
    {
      message: "Warning on line 10",
      severity: 1,
      source: "eslint",
      code: "no-shadow",
      range: { start: { line: 9 }, end: { line: 9 } },
    },
    {
      message: "Type 'string' is not assignable to type 'number'.",
      severity: 0,
      source: "ts",
      code: 2322,
      range: { start: { line: 12 }, end: { line: 12 } },
    },
    {
      // Duplicate of line 12 message
      message: "  Type 'string' is not assignable to type 'number'.  ",
      severity: 0,
      source: "ts",
      code: 2322,
      range: { start: { line: 12 }, end: { line: 12 } },
    },
    {
      message: "Cannot find name 'foo'.",
      severity: 0,
      source: "ts",
      code: { value: "TS2304" },
      range: { start: { line: 14 }, end: { line: 14 } },
    },
    {
      message: "Error 3",
      severity: 0,
      range: { start: { line: 15 }, end: { line: 15 } },
    },
    {
      message: "Error 4",
      severity: 0,
      range: { start: { line: 16 }, end: { line: 16 } },
    },
    {
      message: "Error 5",
      severity: 0,
      range: { start: { line: 17 }, end: { line: 17 } },
    },
    {
      message: "Error 6 (should be capped)",
      severity: 0,
      range: { start: { line: 18 }, end: { line: 18 } },
    },
  ];

  const selected = selectRelevantDiagnostics(mixed, 5);
  assert.equal(selected.length, 5);
  assert.equal(selected.every((d) => d.severity === 0), true);
  assert.equal(selected[0]?.range.start.line, 12);
  assert.equal(selected[1]?.range.start.line, 14);

  // Build diagnostic injection with long source lines to verify 4,000-char snippet cap
  const longLines = Array.from({ length: 30 }, (_, idx) =>
    idx === 12 ? `const x: number = "${"a".repeat(6_000)}";` : `// line ${idx + 1}`,
  );
  const injection = buildDiagnosticInjection({
    id: "diag_test_1",
    intent: "fix",
    filePath: "/workspace/src/math.ts",
    relativePath: "src/math.ts",
    languageId: "typescript",
    diagnostics: mixed,
    documentLines: longLines,
    workingDir: "/workspace",
    autoSubmit: false,
  });

  const parsed = ComposerInjectionPayloadSchema.parse(injection);
  assert.equal(parsed.id, "diag_test_1");
  assert.deepEqual(parsed.mentions, ["src/math.ts"]);
  assert.equal(parsed.autoSubmit, false);
  assert.ok(parsed.prompt?.includes("src/math.ts"));
  assert.ok(parsed.prompt?.includes("L13-L18"));
  assert.ok(parsed.prompt?.includes("[Error] (ts 2322) L13:"));
  assert.ok(parsed.prompt?.includes("[Error] (ts TS2304) L15:"));
  assert.ok(parsed.selection?.selectedText);
  assert.ok(parsed.selection!.selectedText!.length <= 4_000);
  assert.ok(parsed.selection!.selectedText!.includes("... (truncated)"));
});

test("stripAnsiCodes and buildTerminalInjection handle ANSI/OSC sequences and both capture kinds", () => {
  const raw =
    "\u001b]633;C\u0007\u001b[31merror[E0382]\u001b[0m: borrow of moved value\r\n" +
    "\u001b]8;;file:///src/main.rs\u001b\\src/main.rs:42\u001b]8;;\u001b\\\r\n" +
    "\u001b[2K\u001b[1Gdone\u0007";
  const cleaned = stripAnsiCodes(raw);
  assert.equal(cleaned, "error[E0382]: borrow of moved value\nsrc/main.rs:42\ndone");

  const selInj = buildTerminalInjection(
    {
      kind: "selection",
      text: "\u001b[31mTypeError: cannot read properties of undefined\u001b[0m",
      terminalName: "zsh",
    },
    "fix",
    { id: "term_sel_1", workingDir: "/workspace", autoSubmit: true },
  );
  const parsedSel = ComposerInjectionPayloadSchema.parse(selInj);
  assert.equal(parsedSel.autoSubmit, true);
  assert.equal(parsedSel.workingDir, "/workspace");
  assert.ok(parsedSel.prompt?.includes("(zsh)"));
  assert.ok(parsedSel.prompt?.includes("TypeError: cannot read properties of undefined"));
  assert.equal(parsedSel.prompt?.includes("\u001b["), false);

  const cmdInj = buildTerminalInjection(
    {
      kind: "lastCommand",
      commandLine: "cargo test -p rayucode-core",
      exitCode: 101,
      cwd: "/workspace/crates",
      output: "\u001b[31mtest auth::refresh ... FAILED\u001b[0m",
      terminalName: "bash",
    },
    "ask",
    { id: "term_cmd_1" },
  );
  const parsedCmd = ComposerInjectionPayloadSchema.parse(cmdInj);
  assert.equal(parsedCmd.autoSubmit, false);
  assert.equal(parsedCmd.workingDir, "/workspace/crates");
  assert.ok(parsedCmd.prompt?.includes("cargo test -p rayucode-core"));
  assert.ok(parsedCmd.prompt?.includes("Exit code: 101"));
  assert.ok(parsedCmd.prompt?.includes("test auth::refresh ... FAILED"));
  assert.equal(parsedCmd.prompt?.includes("\u001b["), false);
});

test("resolveTargetCodeColumn never overwrites RayuCode panel column", () => {
  // Panel beside in Column 2, last text editor in Column 1 -> Column 1
  assert.equal(resolveTargetCodeColumn(1, 2), 1);
  // Panel in Column 1, last text editor in Column 1 -> Column 2
  assert.equal(resolveTargetCodeColumn(1, 1), 2);
  // Panel in Column 1, no prior editor -> Column 2
  assert.equal(resolveTargetCodeColumn(undefined, 1), 2);
  // Panel in Column 2, no prior editor -> Column 1
  assert.equal(resolveTargetCodeColumn(undefined, 2), 1);
  // Sidebar only (no panel), last text editor in Column 3 -> Column 3
  assert.equal(resolveTargetCodeColumn(3, undefined), 3);
  // Sidebar only, no prior editor -> Column 1
  assert.equal(resolveTargetCodeColumn(undefined, undefined), 1);
});

test("sanitizeFileOpenTarget, buildFilePathCandidates, and rankWorkspaceFileMatches resolve workspace-prefixed, bare, file://, and multi-root mentions", () => {
  assert.deepEqual(sanitizeFileOpenTarget("`@desktop/MIGRATION_PLAN.md:12-20`"), {
    path: "desktop/MIGRATION_PLAN.md",
    line: 12,
  });
  assert.deepEqual(
    sanitizeFileOpenTarget("file:///home/rayu/my%20repo/how-to-run.md#L5-L9"),
    {
      path: "/home/rayu/my repo/how-to-run.md",
      line: 5,
    },
  );
  assert.deepEqual(sanitizeFileOpenTarget("./src/App.tsx:42:8"), {
    path: "src/App.tsx",
    line: 42,
    column: 8,
  });
  assert.deepEqual(sanitizeFileOpenTarget("file:///C:/repo/src/main.rs:9"), {
    path: "C:/repo/src/main.rs",
    line: 9,
  });

  // Workspace-folder-name-prefixed path (`rayucode-v2/desktop/MIGRATION_PLAN.md`)
  // resolves cleanly to `/home/rayu/rayu/rayucode-v2/desktop/MIGRATION_PLAN.md`
  const candidates = buildFilePathCandidates(
    "rayucode-v2/desktop/MIGRATION_PLAN.md",
    ["/home/rayu/rayu/rayucode-v2"],
  );
  assert.ok(
    candidates.includes("/home/rayu/rayu/rayucode-v2/desktop/MIGRATION_PLAN.md"),
    `Expected stripped workspace-root candidate, got: ${JSON.stringify(candidates)}`,
  );

  // Bare filename `MIGRATION_PLAN.md` prefers active session dir & shallower depth
  const ranked = rankWorkspaceFileMatches(
    "MIGRATION_PLAN.md",
    [
      "/home/rayu/rayu/rayucode-v2/archive/old/MIGRATION_PLAN.md",
      "/home/rayu/rayu/rayucode-v2/desktop/MIGRATION_PLAN.md",
    ],
    ["/home/rayu/rayu/rayucode-v2/desktop"],
  );
  assert.equal(ranked[0], "/home/rayu/rayu/rayucode-v2/desktop/MIGRATION_PLAN.md");

  // Workspace-prefixed suffix ranking (`rayucode-v2/how-to-run.md`)
  const rankedPrefixed = rankWorkspaceFileMatches(
    "rayucode-v2/how-to-run.md",
    [
      "/home/rayu/rayu/rayucode-v2/docs/nested/how-to-run.md",
      "/home/rayu/rayu/rayucode-v2/how-to-run.md",
    ],
    ["/home/rayu/rayu/rayucode-v2"],
  );
  assert.equal(rankedPrefixed[0], "/home/rayu/rayu/rayucode-v2/how-to-run.md");
});

test("normalizeBrowserUrl normalizes bare host/port URLs and rejects unsafe schemes", () => {
  assert.equal(normalizeBrowserUrl("localhost:3000"), "http://localhost:3000/");
  assert.equal(
    normalizeBrowserUrl("127.0.0.1:5173/dashboard"),
    "http://127.0.0.1:5173/dashboard",
  );
  assert.equal(
    normalizeBrowserUrl("https://rayucode.com/docs"),
    "https://rayucode.com/docs",
  );
  assert.equal(normalizeBrowserUrl("javascript:alert(1)"), null);
  assert.equal(normalizeBrowserUrl("file:///etc/passwd"), null);
  assert.equal(normalizeBrowserUrl("   "), null);
});

test("extension.manifest.json enforces Tier 1 + Tier 2 workbench placement and command invariants", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as {
    icon?: string;
    engines: { vscode: string };
    contributes: {
      icons?: Record<string, { default?: { fontPath?: string; fontCharacter?: string } }>;
      viewsContainers?: Record<string, Array<{ id: string; icon?: string }>>;
      submenus?: Array<{ id: string; label: string; icon?: string | { light: string; dark: string } }>;
      commands: Array<{
        command: string;
        title: string;
        icon?: string | { light: string; dark: string };
      }>;
      menus: Record<
        string,
        Array<{ command?: string; alt?: string; submenu?: string; group?: string; when?: string }>
      >;
      keybindings?: Array<{ command: string; key: string }>;
    };
  };

  assert.equal(manifest.engines.vscode, "^1.106.0");
  assert.equal(manifest.icon, "media/rayu-fox.png");

  // Brand icon font contribution
  const rayuIcon = manifest.contributes.icons?.rayucode;
  assert.ok(rayuIcon, "contributes.icons.rayucode missing");
  assert.equal(rayuIcon.default?.fontPath, "media/rayucode-icons.woff");
  assert.equal(rayuIcon.default?.fontCharacter, "\\ea01");

  // Secondary Sidebar default container
  const secondaryContainers = manifest.contributes.viewsContainers?.secondarySidebar;
  assert.ok(Array.isArray(secondaryContainers) && secondaryContainers.length > 0);
  assert.equal(
    secondaryContainers.some((c) => c.id === "rayucode"),
    true,
  );
  assert.equal(secondaryContainers[0]?.icon, "media/rayu-fox-icon.svg");

  // editor/title and scm/title brand commands use full-color Rayu Fox PNG
  const editorTitleCmd = manifest.contributes.commands.find(
    (c) => c.command === "rayucode.openFromEditorTitle",
  );
  assert.deepEqual(editorTitleCmd?.icon, {
    light: "media/rayu-fox.png",
    dark: "media/rayu-fox.png",
  });
  const scmTitleCmd = manifest.contributes.commands.find(
    (c) => c.command === "rayucode.scmOpenChanges",
  );
  assert.deepEqual(scmTitleCmd?.icon, {
    light: "media/rayu-fox.png",
    dark: "media/rayu-fox.png",
  });

  // editor/title navigation button + alt split-beside
  const editorTitle = manifest.contributes.menus["editor/title"] ?? [];
  const primaryEditorTitle = editorTitle.find(
    (entry) => entry.command === "rayucode.openFromEditorTitle",
  );
  assert.ok(primaryEditorTitle, "editor/title primary button missing");
  assert.equal(primaryEditorTitle.group, "navigation@1");
  assert.equal(primaryEditorTitle.alt, "rayucode.openBeside");

  // Tier 2 context menus
  const editorContext = manifest.contributes.menus["editor/context"] ?? [];
  assert.equal(
    editorContext.some((entry) => entry.submenu === "rayucode.editorSubmenu"),
    true,
  );
  assert.ok((manifest.contributes.menus["rayucode.editorSubmenu"] ?? []).length >= 4);
  assert.ok((manifest.contributes.menus["explorer/context"] ?? []).length >= 2);
  assert.ok((manifest.contributes.menus["editor/title/context"] ?? []).length >= 1);
  assert.ok((manifest.contributes.menus["terminal/context"] ?? []).length >= 2);
  assert.ok((manifest.contributes.menus["scm/title"] ?? []).length >= 3);

  // Referential integrity: every menu command, alt command, and keybinding command exists in contributes.commands
  const declaredCommands = new Set(
    manifest.contributes.commands.map((c) => c.command),
  );
  const declaredSubmenus = new Set(
    (manifest.contributes.submenus ?? []).map((s) => s.id),
  );

  for (const [menuId, entries] of Object.entries(manifest.contributes.menus)) {
    for (const entry of entries) {
      if (entry.command) {
        assert.ok(
          declaredCommands.has(entry.command),
          `Menu "${menuId}" references undeclared command "${entry.command}"`,
        );
      }
      if (entry.alt) {
        assert.ok(
          declaredCommands.has(entry.alt),
          `Menu "${menuId}" references undeclared alt command "${entry.alt}"`,
        );
      }
      if (entry.submenu) {
        assert.ok(
          declaredSubmenus.has(entry.submenu),
          `Menu "${menuId}" references undeclared submenu "${entry.submenu}"`,
        );
      }
    }
  }

  for (const kb of manifest.contributes.keybindings ?? []) {
    assert.ok(
      declaredCommands.has(kb.command),
      `Keybinding references undeclared command "${kb.command}"`,
    );
  }

  // Marketplace publishing invariants: valid non-prerelease SemVer, changelog, metadata, and 1:1 command registration
  const fullManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as {
    version?: string;
    publisher?: string;
    files?: string[];
    keywords?: string[];
    galleryBanner?: { color?: string; theme?: string };
  };
  assert.match(
    fullManifest.version ?? "",
    /^\d+\.\d+\.\d+$/,
    `Marketplace version must be MAJOR.MINOR.PATCH without prerelease tag (got ${fullManifest.version})`,
  );
  assert.ok(fullManifest.publisher && /^[a-z0-9][a-z0-9-]*$/i.test(fullManifest.publisher));
  assert.ok(Array.isArray(fullManifest.files) && fullManifest.files.includes("CHANGELOG.md"));
  assert.ok(Array.isArray(fullManifest.keywords) && fullManifest.keywords.length > 0 && fullManifest.keywords.length <= 5);
  assert.ok(fullManifest.galleryBanner?.color && fullManifest.galleryBanner?.theme);

  const hostEntry = fs.readFileSync(
    path.resolve(__dirname, "../host/harnessExtension.ts"),
    "utf8",
  );
  const registeredCommands = new Set(
    [...hostEntry.matchAll(/registerCommand\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
  );
  for (const cmd of declaredCommands) {
    assert.ok(
      registeredCommands.has(cmd),
      `Manifest command "${cmd}" is not registered in host/harnessExtension.ts`,
    );
  }
  for (const cmd of registeredCommands) {
    assert.ok(
      declaredCommands.has(cmd),
      `Registered command "${cmd}" in host/harnessExtension.ts is missing from extension.manifest.json`,
    );
  }
});
