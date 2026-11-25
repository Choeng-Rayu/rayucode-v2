import { describe, expect, it } from "vitest";
import {
  formatEffortLabel,
  resolveEffortLadder,
} from "../../src/client/index.js";

describe("resolveEffortLadder", () => {
  it("returns unsupported empty ladder for null, undefined, or empty routes", () => {
    expect(resolveEffortLadder(null)).toEqual({
      supported: false,
      stops: [],
      defaultStop: null,
    });
    expect(resolveEffortLadder(undefined)).toEqual({
      supported: false,
      stops: [],
      defaultStop: null,
    });
    expect(resolveEffortLadder({ supported_efforts: [], default_effort: null })).toEqual({
      supported: false,
      stops: [],
      defaultStop: null,
    });
  });

  it("returns exact engine stops and selects default_effort without fabricating auto", () => {
    const ladder = resolveEffortLadder({
      supported_efforts: ["low", "medium", "high", "xhigh", "max"],
      default_effort: "high",
    });
    expect(ladder).toEqual({
      supported: true,
      stops: ["low", "medium", "high", "xhigh", "max"],
      defaultStop: "high",
    });
    expect(ladder.stops).not.toContain("auto");
  });

  it("defensively filters swarm* sentinels and deduplicates case-insensitively", () => {
    const ladder = resolveEffortLadder({
      supported_efforts: [
        "minimal",
        "low",
        "swarm",
        "swarm_high",
        "SwarmAuto",
        "medium",
        "MEDIUM",
        "high",
      ],
      default_effort: "swarm",
    });
    expect(ladder).toEqual({
      supported: true,
      stops: ["minimal", "low", "medium", "high"],
      defaultStop: "medium",
    });
  });

  it("falls back to medium -> low -> first stop when default_effort is omitted or invalid", () => {
    expect(
      resolveEffortLadder({
        supported_efforts: ["none", "low", "high"],
        default_effort: null,
      }),
    ).toEqual({
      supported: true,
      stops: ["none", "low", "high"],
      defaultStop: "low",
    });

    expect(
      resolveEffortLadder({
        supported_efforts: ["high", "xhigh", "max"],
        default_effort: "nonexistent",
      }),
    ).toEqual({
      supported: true,
      stops: ["high", "xhigh", "max"],
      defaultStop: "high",
    });
  });

  it("supports camelCase route views as well as wire snake_case fields", () => {
    expect(
      resolveEffortLadder({
        supportedEfforts: ["none", "minimal", "low", "medium", "high"],
        defaultEffort: "minimal",
      }),
    ).toEqual({
      supported: true,
      stops: ["none", "minimal", "low", "medium", "high"],
      defaultStop: "minimal",
    });
  });

  it("returns unsupported if route only contained swarm* sentinels", () => {
    expect(
      resolveEffortLadder({
        supported_efforts: ["swarm", "swarm_max"],
        default_effort: "swarm",
      }),
    ).toEqual({
      supported: false,
      stops: [],
      defaultStop: null,
    });
  });
});

describe("formatEffortLabel", () => {
  it("formats all standard stops matching the UX blueprint", () => {
    expect(formatEffortLabel("none")).toBe("Off");
    expect(formatEffortLabel("none", "tick")).toBe("Off");
    expect(formatEffortLabel("minimal")).toBe("Minimal");
    expect(formatEffortLabel("low")).toBe("Low");
    expect(formatEffortLabel("medium")).toBe("Medium");
    expect(formatEffortLabel("high")).toBe("High");
    expect(formatEffortLabel("xhigh")).toBe("Extra High");
    expect(formatEffortLabel("xhigh", "header")).toBe("Extra High");
    expect(formatEffortLabel("xhigh", "tick")).toBe("X-High");
    expect(formatEffortLabel("max")).toBe("Max");
  });

  it("handles uppercase/padded stops and Title-Cases unknown future stops", () => {
    expect(formatEffortLabel(" XHIGH ", "tick")).toBe("X-High");
    expect(formatEffortLabel("ultra_high")).toBe("Ultra High");
    expect(formatEffortLabel("turbo-mode")).toBe("Turbo Mode");
    expect(formatEffortLabel("extreme")).toBe("Extreme");
    expect(formatEffortLabel("   ")).toBe("");
  });
});
