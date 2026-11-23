import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChangesView,
  parseUnifiedDiffLines,
} from "@/features/changes";
import * as rpcClient from "@/lib/rpc-client";
import { createQueryClient, useAppStore } from "@/lib";

function renderWithQuery(ui: React.ReactElement) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("Changes Review Feature (Wave 3F — Spec 07)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1280,
    });
    useAppStore.setState({
      surface: "editorPanel",
      route: "changes",
      activeRoute: "changes",
      activeSessionId: "ses_vscode_shell",
    });
  });

  it("parses unified diff hunks into structured line numbers and add/del/ctx types", () => {
    const sample = [
      "@@ -10,2 +10,3 @@",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      "+const c = 4;",
    ].join("\n");
    const lines = parseUnifiedDiffLines(sample);
    expect(lines[0]?.type).toBe("hunk");
    expect(lines[1]).toMatchObject({
      type: "ctx",
      oldLineNumber: 10,
      newLineNumber: 10,
    });
    expect(lines[2]).toMatchObject({
      type: "del",
      oldLineNumber: 11,
      mark: "-",
    });
    expect(lines[3]).toMatchObject({
      type: "add",
      newLineNumber: 11,
      mark: "+",
    });
  });

  it("renders ChangesView flat changed files list, branch pill, diff panel, and switches Unified/Split mode", async () => {
    renderWithQuery(<ChangesView />);

    await waitFor(() => {
      expect(screen.getByTestId("changes-view")).toBeTruthy();
    });

    expect(screen.getByTestId("changes-branch-name").textContent).toBe("main");
    expect(screen.getByTestId("flat-changed-files-list")).toBeTruthy();
    expect(
      screen.getByTestId(
        "changed-file-row-vscode/webview/src/styles/globals.css",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("diff-body-unified")).toBeTruthy();

    fireEvent.click(screen.getByTestId("diff-mode-split-tab"));
    await waitFor(() => {
      expect(screen.getByTestId("diff-body-split")).toBeTruthy();
    });
  });

  it("dispatches openDiff to host, toggles stage, runs Keep/Undo, and commits staged files", async () => {
    const postSpy = vi.spyOn(rpcClient, "postToHost");
    renderWithQuery(<ChangesView />);

    await waitFor(() => {
      expect(screen.getByTestId("changes-view")).toBeTruthy();
    });

    const targetPath = "vscode/webview/src/styles/globals.css";
    fireEvent.click(screen.getByTestId(`open-vscode-diff-${targetPath}`));
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "rayucode.editor.openDiff",
        path: targetPath,
      }),
    );

    const secondPath =
      "vscode/webview/src/features/shell/components/AppShell.tsx";
    fireEvent.click(screen.getByTestId(`keep-file-${secondPath}`));
    await waitFor(() => {
      expect(screen.getByTestId(`decision-badge-${secondPath}`).textContent).toBe(
        "Accepted",
      );
    });

    fireEvent.click(screen.getByTestId(`undo-file-${secondPath}`));
    await waitFor(() => {
      expect(screen.getByTestId(`decision-badge-${secondPath}`).textContent).toBe(
        "Rejected",
      );
    });

    const commitInput = screen.getByTestId("commit-message-input");
    fireEvent.change(commitInput, {
      target: { value: "feat(vscode): add changes review" },
    });
    fireEvent.submit(screen.getByTestId("commit-staged-form"));

    await waitFor(() => {
      expect(screen.getByTestId("commit-receipt")).toBeTruthy();
    });

    postSpy.mockRestore();
  });

  it("opens CreatePrDialog approval guardrail without auto-pushing and creates PR on confirmation", async () => {
    const callSpy = vi.spyOn(rpcClient, "callRpc");
    renderWithQuery(<ChangesView />);

    await waitFor(() => {
      expect(screen.getByTestId("changes-view")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("create-pr-btn"));
    expect(screen.getByTestId("create-pr-guardrail-dialog")).toBeTruthy();

    // Opening the dialog must NEVER call changes.createPr automatically
    expect(callSpy).not.toHaveBeenCalledWith(
      "changes.createPr",
      expect.anything(),
    );

    fireEvent.change(screen.getByTestId("pr-title-input"), {
      target: { value: "feat(vscode): changes review & PR guardrail" },
    });
    fireEvent.click(screen.getByTestId("pr-confirm-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("created-pr-banner")).toBeTruthy();
    });

    callSpy.mockRestore();
  });
});
