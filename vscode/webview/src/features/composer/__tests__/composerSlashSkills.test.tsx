import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createQueryClient } from "@/lib";

import { SessionComposer } from "../components/SessionComposer";

function renderComposer(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>,
  );
}

describe("SessionComposer mid-sentence /skill autocomplete", () => {
  it("opens SlashCommandMenu mid-sentence and splices only the active /token", () => {
    const Wrapper = () => {
      const [val, setVal] = React.useState("");
      return <SessionComposer value={val} onValueChange={setVal} />;
    };

    renderComposer(<Wrapper />);
    const textarea = screen.getByTestId(
      "composer-textarea",
    ) as HTMLTextAreaElement;

    const text = "Please /rev";
    fireEvent.change(textarea, {
      target: {
        value: text,
        selectionStart: text.length,
        selectionEnd: text.length,
      },
    });

    const menu = screen.getByTestId("slash-command-menu");
    expect(menu).toBeTruthy();

    const reviewItem = screen
      .getAllByTestId("slash-command-item")
      .find((el) => el.getAttribute("data-command") === "/review");
    expect(reviewItem).toBeTruthy();

    fireEvent.click(reviewItem!);
    expect(textarea.value).toBe("Please /review ");
  });

  it("preserves trailing text when editing mid-sentence at caret", () => {
    const Wrapper = () => {
      const [val, setVal] = React.useState("Check /rev before merging");
      return <SessionComposer value={val} onValueChange={setVal} />;
    };

    renderComposer(<Wrapper />);
    const textarea = screen.getByTestId(
      "composer-textarea",
    ) as HTMLTextAreaElement;

    textarea.setSelectionRange(10, 10);
    fireEvent.select(textarea, {
      target: { selectionStart: 10, selectionEnd: 10 },
    });

    const reviewItem = screen
      .getAllByTestId("slash-command-item")
      .find((el) => el.getAttribute("data-command") === "/review");
    expect(reviewItem).toBeTruthy();

    fireEvent.click(reviewItem!);
    expect(textarea.value).toBe("Check /review before merging");
  });

  it("gives @file mention precedence over / when typing a path with slashes", () => {
    const Wrapper = () => {
      const [val, setVal] = React.useState("");
      return <SessionComposer value={val} onValueChange={setVal} />;
    };

    renderComposer(<Wrapper />);
    const textarea = screen.getByTestId(
      "composer-textarea",
    ) as HTMLTextAreaElement;
    const text = "Inspect @src/app";
    fireEvent.change(textarea, {
      target: {
        value: text,
        selectionStart: text.length,
        selectionEnd: text.length,
      },
    });

    expect(screen.getByTestId("mention-menu")).toBeTruthy();
    expect(screen.queryByTestId("slash-command-menu")).toBeNull();
  });
});
