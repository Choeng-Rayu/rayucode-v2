import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import {
  checkAndUpdateManagedBinary,
  compareReleaseVersions,
  ensureManagedBinary,
  extractBinaryFromTarGz,
  fetchLatestReleaseVersion,
  isValidReleaseTag,
  parseSha256Sums,
  readInstallerState,
  readManagedBinaryInfo,
  resolveReleaseTarget,
} from "../host/runtime/binaryInstaller.js";

function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rayu-installer-test-"));
  const finish = () => {
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return Promise.resolve(fn(dir)).finally(finish);
}

function buildUstarHeader(name: string, size: number, typeflag = "0"): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, Math.min(name.length, 100), "utf8");
  header.write("0000755\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header.write(typeflag, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  let sum = 0;
  for (let i = 0; i < 512; i += 1) {
    sum += header[i];
  }
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function buildTarGzBuffer(
  entries: Array<{ name: string; content: Buffer; type?: string }>,
): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    if (entry.type === "L") {
      const nameBuf = Buffer.from(`${entry.content.toString("utf8")}\0`, "utf8");
      blocks.push(buildUstarHeader("././@LongLink", nameBuf.length, "L"));
      blocks.push(nameBuf);
      const pad = (512 - (nameBuf.length % 512)) % 512;
      if (pad > 0) blocks.push(Buffer.alloc(pad, 0));
      continue;
    }
    blocks.push(buildUstarHeader(entry.name, entry.content.length, entry.type ?? "0"));
    if (entry.content.length > 0) {
      blocks.push(entry.content);
      const pad = (512 - (entry.content.length % 512)) % 512;
      if (pad > 0) blocks.push(Buffer.alloc(pad, 0));
    }
  }
  blocks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(blocks));
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

test("resolveReleaseTarget maps all 6 release targets and rejects unsupported arch", () => {
  assert.equal(resolveReleaseTarget("linux", "x64")?.assetName, "rayu-linux-x86_64.tar.gz");
  assert.equal(resolveReleaseTarget("linux", "arm64")?.assetName, "rayu-linux-aarch64.tar.gz");
  assert.equal(resolveReleaseTarget("darwin", "arm64")?.assetName, "rayu-macos-aarch64.tar.gz");
  assert.equal(resolveReleaseTarget("darwin", "x64")?.assetName, "rayu-macos-x86_64.tar.gz");
  assert.equal(resolveReleaseTarget("win32", "x64")?.binaryName, "rayu-windows-x86_64.exe");
  assert.equal(
    resolveReleaseTarget("win32", "arm64")?.fallbackAssetName,
    "rayu-windows-aarch64.exe",
  );
  assert.equal(resolveReleaseTarget("freebsd", "x64"), null);
});

test("isValidReleaseTag and compareReleaseVersions validate and compare semver tags accurately", () => {
  assert.equal(isValidReleaseTag("3.0.1"), true);
  assert.equal(isValidReleaseTag("v3.1.0"), true);
  assert.equal(isValidReleaseTag("3.1.0-rc.2"), true);
  assert.equal(isValidReleaseTag("../bad"), false);
  assert.equal(isValidReleaseTag("3.0.1/extra"), false);
  assert.equal(isValidReleaseTag("latest"), false);

  assert.equal(compareReleaseVersions("3.0.10", "3.0.2"), 1);
  assert.equal(compareReleaseVersions("v3.1.0", "3.0.9"), 1);
  assert.equal(compareReleaseVersions("3.1.0", "3.1.0-rc.1"), 1);
  assert.equal(compareReleaseVersions("v3.0.1", "3.0.1"), 0);
  assert.equal(compareReleaseVersions("2.9.9", "3.0.0"), -1);
});

test("parseSha256Sums parses both standard and binary/dot-slash checksum lines", () => {
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const parsed = parseSha256Sums(
    `${hashA}  ./rayu-linux-x86_64.tar.gz\n${hashB} *rayu-windows-x86_64.exe\n# comment\n`,
  );
  assert.equal(parsed.get("rayu-linux-x86_64.tar.gz"), hashA);
  assert.equal(parsed.get("rayu-windows-x86_64.exe"), hashB);
});

test("extractBinaryFromTarGz extracts target binary cleanly and ignores license/traversal entries", async () => {
  await withTempDir(async (dir) => {
    const archivePath = path.join(dir, "rayu.tar.gz");
    const destPath = path.join(dir, "out", "rayu-linux-x86_64");
    const expectedBytes = Buffer.from("#!/bin/sh\necho rayu\n");

    const tgz = buildTarGzBuffer([
      { name: "./THIRD_PARTY_NOTICES", content: Buffer.from("MIT license") },
      { name: "../../evil-binary", content: Buffer.from("bad") },
      { name: "./rayu-linux-x86_64", content: expectedBytes },
    ]);
    fs.writeFileSync(archivePath, tgz);

    await extractBinaryFromTarGz(archivePath, "rayu-linux-x86_64", destPath);
    assert.equal(fs.readFileSync(destPath, "utf8"), expectedBytes.toString("utf8"));
  });
});

test("extractBinaryFromTarGz supports GNU LongName header and rejects missing binary", async () => {
  await withTempDir(async (dir) => {
    const archivePath = path.join(dir, "long.tar.gz");
    const destPath = path.join(dir, "bin", "rayu-macos-aarch64");
    const payload = Buffer.from("macho-binary-stub");

    const tgz = buildTarGzBuffer([
      {
        name: "long",
        content: Buffer.from("dist/nested/very-long-prefix/rayu-macos-aarch64"),
        type: "L",
      },
      { name: "truncated", content: payload },
    ]);
    fs.writeFileSync(archivePath, tgz);
    await extractBinaryFromTarGz(archivePath, "rayu-macos-aarch64", destPath);
    assert.deepEqual(fs.readFileSync(destPath), payload);

    const missingArchive = path.join(dir, "missing.tar.gz");
    fs.writeFileSync(
      missingArchive,
      buildTarGzBuffer([{ name: "README.md", content: Buffer.from("hi") }]),
    );
    await assert.rejects(
      extractBinaryFromTarGz(missingArchive, "rayu-macos-aarch64", path.join(dir, "none")),
      /did not contain rayu-macos-aarch64/,
    );
  });
});

test("fetchLatestReleaseVersion falls back from release-metadata to GitHub API and HTML redirect", async () => {
  const redirectFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("release-metadata")) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes("api.github.com")) {
      return new Response("rate limited", { status: 403 });
    }
    const resp = new Response(null, { status: 200 });
    Object.defineProperty(resp, "url", {
      value: "https://github.com/Choeng-Rayu/rayucode-v2/releases/tag/3.2.5",
    });
    return resp;
  };

  const version = await fetchLatestReleaseVersion({ fetchImpl: redirectFetch });
  assert.equal(version, "3.2.5");
});

test("ensureManagedBinary downloads, verifies SHA-256, writes versioned layout, and caches offline", async () => {
  await withTempDir(async (dir) => {
    const binContent = Buffer.from("#!/bin/sh\necho rayu-3.1.0\n");
    const tgz = buildTarGzBuffer([{ name: "rayu-linux-x86_64", content: binContent }]);
    const tgzSha = sha256Hex(tgz);

    let downloadHits = 0;
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/releases/latest/version")) {
        return new Response("3.1.0\n", { status: 200 });
      }
      if (url.endsWith("/3.1.0/SHA256SUMS")) {
        return new Response(`${tgzSha}  rayu-linux-x86_64.tar.gz\n`, { status: 200 });
      }
      if (url.endsWith("/3.1.0/download-bases")) {
        return new Response("https://mirror.example.com/releases/3.1.0\n", { status: 200 });
      }
      if (url === "https://mirror.example.com/releases/3.1.0/rayu-linux-x86_64.tar.gz") {
        downloadHits += 1;
        return new Response(new Uint8Array(tgz), {
          status: 200,
          headers: { "content-length": String(tgz.length) },
        });
      }
      return new Response("not found", { status: 404 });
    };

    const progressEvents: Array<{
      phase: string;
      percent?: number;
      downloadedBytes?: number;
      totalBytes?: number;
      message: string;
    }> = [];
    const first = await ensureManagedBinary({
      storageDir: dir,
      platform: "linux",
      arch: "x64",
      extensionVersion: "3.0.1",
      fetchImpl: fakeFetch,
      onProgress: (ev) =>
        progressEvents.push({
          phase: ev.phase,
          percent: ev.percent,
          downloadedBytes: ev.downloadedBytes,
          totalBytes: ev.totalBytes,
          message: ev.message,
        }),
    });

    assert.equal(first.version, "3.1.0");
    assert.equal(first.updated, true);
    assert.equal(first.source, "managed-downloaded");
    assert.equal(downloadHits, 1);
    assert.equal(fs.readFileSync(first.binaryPath, "utf8"), binContent.toString("utf8"));
    const downloadEvent = progressEvents.find(
      (ev) => ev.phase === "downloading" && (ev.downloadedBytes ?? 0) > 0,
    );
    assert.ok(downloadEvent);
    assert.equal(downloadEvent.totalBytes, tgz.length);
    assert.ok(downloadEvent.message.includes("please wait"));
    const numericPercents = progressEvents
      .map((ev) => ev.percent)
      .filter((p): p is number => typeof p === "number");
    assert.ok(numericPercents.includes(90));
    assert.ok(numericPercents.includes(95));
    assert.ok(numericPercents.includes(100));
    for (let i = 1; i < numericPercents.length; i += 1) {
      assert.ok(numericPercents[i] >= numericPercents[i - 1]);
    }

    const info = readManagedBinaryInfo(dir);
    assert.equal(info?.version, "3.1.0");
    assert.equal(info?.extensionVersion, "3.0.1");

    // Second call uses local cache without touching fetch
    const offlineFetch: typeof fetch = async () => {
      throw new Error("should not call fetch when cached");
    };
    const second = await ensureManagedBinary({
      storageDir: dir,
      platform: "linux",
      arch: "x64",
      extensionVersion: "3.0.1",
      fetchImpl: offlineFetch,
    });
    assert.equal(second.source, "managed-cached");
    assert.equal(second.binaryPath, first.binaryPath);
  });
});

test("ensureManagedBinary rejects SHA-256 mismatch and leaves current.json untouched", async () => {
  await withTempDir(async (dir) => {
    const tgz = buildTarGzBuffer([
      { name: "rayu-linux-x86_64", content: Buffer.from("tampered") },
    ]);
    const wrongSha = "f".repeat(64);
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/releases/latest/version")) return new Response("3.1.0\n", { status: 200 });
      if (url.endsWith("/SHA256SUMS")) {
        return new Response(`${wrongSha}  rayu-linux-x86_64.tar.gz\n`, { status: 200 });
      }
      if (url.endsWith("/download-bases")) return new Response("", { status: 404 });
      if (url.endsWith("/rayu-linux-x86_64.tar.gz")) {
        return new Response(new Uint8Array(tgz), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    await assert.rejects(
      ensureManagedBinary({
        storageDir: dir,
        platform: "linux",
        arch: "x64",
        fetchImpl: fakeFetch,
      }),
      /Checksum mismatch/,
    );
    assert.equal(readManagedBinaryInfo(dir), null);
  });
});

test("checkAndUpdateManagedBinary respects 4h cooldown, bypasses on Marketplace upgrade, and preserves previous binary on error", async () => {
  await withTempDir(async (dir) => {
    const v1Bin = Buffer.from("#!/bin/sh\necho v3.1.0\n");
    const v1Tgz = buildTarGzBuffer([{ name: "rayu-macos-aarch64", content: v1Bin }]);
    const v2Bin = Buffer.from("#!/bin/sh\necho v3.2.0\n");
    const v2Tgz = buildTarGzBuffer([{ name: "rayu-macos-aarch64", content: v2Bin }]);

    let servedLatest = "3.1.0";
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/releases/latest/version")) {
        return new Response(`${servedLatest}\n`, { status: 200 });
      }
      if (url.endsWith("/3.1.0/SHA256SUMS")) {
        return new Response(`${sha256Hex(v1Tgz)}  rayu-macos-aarch64.tar.gz\n`, { status: 200 });
      }
      if (url.endsWith("/3.2.0/SHA256SUMS")) {
        return new Response(`${sha256Hex(v2Tgz)}  rayu-macos-aarch64.tar.gz\n`, { status: 200 });
      }
      if (url.endsWith("/download-bases")) return new Response("", { status: 404 });
      if (url.includes("/3.1.0/rayu-macos-aarch64.tar.gz")) {
        return new Response(new Uint8Array(v1Tgz), { status: 200 });
      }
      if (url.includes("/3.2.0/rayu-macos-aarch64.tar.gz")) {
        return new Response(new Uint8Array(v2Tgz), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    await ensureManagedBinary({
      storageDir: dir,
      platform: "darwin",
      arch: "arm64",
      extensionVersion: "3.0.1",
      fetchImpl: fakeFetch,
    });

    // Server publishes 3.2.0, but within 4h cooldown & same extensionVersion -> skips check
    servedLatest = "3.2.0";
    const skipped = await checkAndUpdateManagedBinary({
      storageDir: dir,
      platform: "darwin",
      arch: "arm64",
      extensionVersion: "3.0.1",
      fetchImpl: fakeFetch,
    });
    assert.equal(skipped.checked, false);
    assert.equal(skipped.updated, false);
    assert.equal(readManagedBinaryInfo(dir)?.version, "3.1.0");

    // Extension upgrades from 3.0.1 -> 3.0.2 on Marketplace -> bypasses 4h cooldown immediately
    const upgraded = await checkAndUpdateManagedBinary({
      storageDir: dir,
      platform: "darwin",
      arch: "arm64",
      extensionVersion: "3.0.2",
      fetchImpl: fakeFetch,
    });
    assert.equal(upgraded.checked, true);
    assert.equal(upgraded.updated, true);
    assert.equal(upgraded.currentVersion, "3.2.0");
    assert.equal(readManagedBinaryInfo(dir)?.extensionVersion, "3.0.2");

    // Failed check keeps 3.2.0 intact
    const failingFetch: typeof fetch = async () => {
      throw new Error("offline");
    };
    const failed = await checkAndUpdateManagedBinary({
      storageDir: dir,
      platform: "darwin",
      arch: "arm64",
      extensionVersion: "3.0.2",
      force: true,
      fetchImpl: failingFetch,
    });
    assert.equal(failed.updated, false);
    assert.equal(failed.error, "offline");
    assert.equal(readManagedBinaryInfo(dir)?.version, "3.2.0");
    assert.ok(readInstallerState(dir)?.lastError);
  });
});

test("checkAndUpdateManagedBinary retries immediately when managed binary is missing despite recent state check", async () => {
  await withTempDir(async (dir) => {
    const bin = Buffer.from("#!/bin/sh\necho v3.3.0\n");
    const tgz = buildTarGzBuffer([{ name: "rayu-linux-x86_64", content: bin }]);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({
        lastCheckedAt: new Date().toISOString(),
        lastExtensionVersion: "3.0.1",
        lastError: "offline earlier",
      }),
    );

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/releases/latest/version")) return new Response("3.3.0\n", { status: 200 });
      if (url.endsWith("/3.3.0/SHA256SUMS")) {
        return new Response(`${sha256Hex(tgz)}  rayu-linux-x86_64.tar.gz\n`, { status: 200 });
      }
      if (url.endsWith("/download-bases")) return new Response("", { status: 404 });
      if (url.endsWith("/3.3.0/rayu-linux-x86_64.tar.gz")) {
        return new Response(new Uint8Array(tgz), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const res = await checkAndUpdateManagedBinary({
      storageDir: dir,
      platform: "linux",
      arch: "x64",
      extensionVersion: "3.0.1",
      fetchImpl: fakeFetch,
    });
    assert.equal(res.checked, true);
    assert.equal(res.updated, true);
    assert.equal(res.currentVersion, "3.3.0");
  });
});

test("extractBinaryFromTarGz extracts portable wrapper, companion .bin, and OpenSSL shared libraries together", async () => {
  await withTempDir(async (dir) => {
    const archivePath = path.join(dir, "portable.tar.gz");
    const versionDir = path.join(dir, "versions", "v3.0.9");
    const destPath = path.join(versionDir, "rayu-linux-x86_64");

    const wrapperScript = Buffer.from(
      '#!/usr/bin/env sh\nself_dir="$(cd "$(dirname "$0")" && pwd)"\nexec "$self_dir/rayu-linux-x86_64.bin" "$@"\n',
    );
    const companionBin = Buffer.from("#!/usr/bin/env sh\necho 'rayu v3.0.9'\n");
    const libssl = Buffer.from("elf-libssl");
    const libcrypto = Buffer.from("elf-libcrypto");
    const notices = Buffer.from("Apache-2.0");

    fs.writeFileSync(
      archivePath,
      buildTarGzBuffer([
        { name: "rayu-linux-x86_64", content: wrapperScript },
        { name: "rayu-linux-x86_64.bin", content: companionBin },
        { name: "libssl.so.3", content: libssl },
        { name: "libcrypto.so.3", content: libcrypto },
        { name: "THIRD_PARTY_NOTICES", content: notices },
      ]),
    );

    await extractBinaryFromTarGz(archivePath, "rayu-linux-x86_64", destPath);
    assert.equal(fs.readFileSync(destPath, "utf8"), wrapperScript.toString("utf8"));
    assert.equal(
      fs.readFileSync(path.join(versionDir, "rayu-linux-x86_64.bin"), "utf8"),
      companionBin.toString("utf8"),
    );
    assert.equal(fs.readFileSync(path.join(versionDir, "libssl.so.3"), "utf8"), "elf-libssl");
    assert.equal(
      fs.readFileSync(path.join(versionDir, "libcrypto.so.3"), "utf8"),
      "elf-libcrypto",
    );
    assert.equal(fs.existsSync(path.join(versionDir, "THIRD_PARTY_NOTICES")), false);

    if (process.platform !== "win32") {
      const { execFileSync } = await import("node:child_process");
      const out = execFileSync(destPath, ["--version"], { encoding: "utf8" });
      assert.equal(out.trim(), "rayu v3.0.9");
    }
  });
});

test("ensureManagedBinary supports Windows .exe fallback when .tar.gz is absent", async () => {
  await withTempDir(async (dir) => {
    const exeStub = Buffer.from("MZ-windows-pe-stub");
    const exeSha = sha256Hex(exeStub);
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/releases/latest/version")) return new Response("3.1.0\n", { status: 200 });
      if (url.endsWith("/3.1.0/SHA256SUMS")) {
        return new Response(`${exeSha}  rayu-windows-x86_64.exe\n`, { status: 200 });
      }
      if (url.endsWith("/download-bases")) return new Response("", { status: 404 });
      if (url.endsWith("/3.1.0/rayu-windows-x86_64.exe")) {
        return new Response(new Uint8Array(exeStub), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const res = await ensureManagedBinary({
      storageDir: dir,
      platform: "win32",
      arch: "x64",
      fetchImpl: fakeFetch,
    });
    assert.equal(res.version, "3.1.0");
    assert.ok(res.binaryPath.endsWith("rayu-windows-x86_64.exe"));
    assert.deepEqual(fs.readFileSync(res.binaryPath), exeStub);
  });
});
