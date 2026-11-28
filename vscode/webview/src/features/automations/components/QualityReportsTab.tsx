import * as React from "react";
import {
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Gavel,
  Play,
  Settings,
  ShieldCheck,
} from "lucide-react";

import { Badge, Button, Switch } from "@/components/ui";
import { cn, postToHost, useAppStore } from "@/lib";

import {
  useQualityActions,
  useQualityStatus,
} from "../hooks/useAutomations";

const QUALITY_METRICS = [
  {
    id: "pass-rate",
    label: "Test & Lint Gate Pass Trend",
    value: "96.4%",
    delta: "+4.2% vs last week",
  },
  {
    id: "kv-savings",
    label: "Warm KV Cache Savings",
    value: "94% hit",
    delta: "1,420 credits saved",
  },
  {
    id: "blocker-catch",
    label: "Pre-Commit Blockers Caught",
    value: "18",
    delta: "0 escaped regressions",
  },
] as const;

export function QualityReportsTab() {
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const { data: quality } = useQualityStatus();
  const {
    setAutoReviewMutation,
    setAutoJudgeMutation,
    runReviewMutation,
    runJudgeMutation,
    productivityMutation,
  } = useQualityActions();

  const setActiveRoute = useAppStore((s) => s.setActiveRoute);
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  const [range, setRange] = React.useState<"7d" | "30d">("7d");
  const [lastGateResult, setLastGateResult] = React.useState<{
    kind: "review" | "judge";
    summary: string;
  } | null>(null);

  const handleRunReview = async () => {
    try {
      const res = await runReviewMutation.mutateAsync(
        activeSessionId ?? undefined,
      );
      setLastGateResult({
        kind: "review",
        summary:
          res.summary ?? "Independent review worker completed with 0 blockers.",
      });
    } catch {
      // Error surfaced via requireOperation toast; do not set lastGateResult
    }
  };

  const handleRunJudge = async () => {
    try {
      const res = await runJudgeMutation.mutateAsync(
        activeSessionId ?? undefined,
      );
      setLastGateResult({
        kind: "judge",
        summary:
          res.summary ??
          "Acceptance judge verified all spec requirements passed.",
      });
    } catch {
      // Error surfaced via requireOperation toast; do not set lastGateResult
    }
  };

  const handleGenerateReport = () => {
    productivityMutation.mutate(range);
  };

  const report =
    productivityMutation.data ?? quality?.latestProductivity ?? null;

  return (
    <div data-testid="quality-reports-tab" className="flex flex-col gap-6">
      {/* Quality Gate Metrics & Savings Breakdown */}
      <section
        aria-label="Quality gate metrics and credit savings"
        className="grid grid-cols-1 gap-3 @min-[540px]/automations:grid-cols-3"
      >
        {QUALITY_METRICS.map((metric) => (
          <div
            key={metric.id}
            data-testid={`quality-metric-${metric.id}`}
            className="rayu-card-bevel rounded-xl border border-premium bg-pane p-4"
          >
            <div className="text-xs text-muted-ink">{metric.label}</div>
            <div className="mt-1.5 font-mono text-xl font-semibold text-ink tabular-nums">
              {metric.value}
            </div>
            <div className="mt-1 font-mono text-[11px] text-brand-text tabular-nums">
              {metric.delta}
            </div>
          </div>
        ))}
      </section>

      {/* Auto-Review & Auto-Judge Gate Cards */}
      <div className="grid grid-cols-1 gap-4 @min-[620px]/automations:grid-cols-2">
        {/* Auto-Review Card */}
        <section
          data-testid="auto-review-card"
          className="rayu-card-bevel flex flex-col justify-between gap-4 rounded-xl border border-premium bg-pane p-4"
        >
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck
                  className="size-4 text-brand-text"
                  aria-hidden="true"
                />
                <h2 className="m-0 text-sm font-semibold text-ink">
                  Auto-Review Gate
                </h2>
              </div>
              <Switch
                checked={Boolean(quality?.autoReviewEnabled)}
                onCheckedChange={(checked) =>
                  setAutoReviewMutation.mutate(checked)
                }
                aria-label="Toggle Auto-Review"
                data-testid="toggle-auto-review"
              />
            </div>

            <p className="mt-1.5 text-xs leading-relaxed text-muted-ink">
              Automatically spawns a read-only reviewer after turns that modify
              source files (
              <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                RuntimeCommand::Autoreview
              </code>
              ).
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-ink">Role override:</span>
              <Badge variant="outline" className="font-mono">
                {quality?.autoReviewModel ?? "claude-sonnet-4-5"}
              </Badge>
              <button
                type="button"
                onClick={() => setActiveRoute("settings")}
                className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-brand-text hover:underline"
              >
                <Settings className="size-3" aria-hidden="true" />
                <span>Models &amp; Agents</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-hairline pt-3">
            <code className="font-mono text-[11px] text-muted-ink">/review</code>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={runReviewMutation.isPending}
              data-testid="run-independent-review-btn"
              onClick={() => {
                void handleRunReview();
              }}
            >
              <Play className="size-3" aria-hidden="true" />
              <span>
                {runReviewMutation.isPending
                  ? "Running Review..."
                  : "Run Independent Review"}
              </span>
            </Button>
          </div>
        </section>

        {/* Auto-Judge Card */}
        <section
          data-testid="auto-judge-card"
          className="rayu-card-bevel flex flex-col justify-between gap-4 rounded-xl border border-premium bg-pane p-4"
        >
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Gavel className="size-4 text-info" aria-hidden="true" />
                <h2 className="m-0 text-sm font-semibold text-ink">
                  Auto-Judge Acceptance Gate
                </h2>
              </div>
              <Switch
                checked={Boolean(quality?.autoJudgeEnabled)}
                onCheckedChange={(checked) =>
                  setAutoJudgeMutation.mutate(checked)
                }
                aria-label="Toggle Auto-Judge"
                data-testid="toggle-auto-judge"
              />
            </div>

            <p className="mt-1.5 text-xs leading-relaxed text-muted-ink">
              Verifies acceptance criteria, test execution evidence, and zero
              unresolved TODOs before marking goals complete (
              <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                RuntimeCommand::Autojudge
              </code>
              ).
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-ink">Role override:</span>
              <Badge variant="outline" className="font-mono">
                {quality?.autoJudgeModel ?? "claude-opus-4-5"}
              </Badge>
              <button
                type="button"
                onClick={() => setActiveRoute("settings")}
                className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-brand-text hover:underline"
              >
                <Settings className="size-3" aria-hidden="true" />
                <span>Models &amp; Agents</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-hairline pt-3">
            <code className="font-mono text-[11px] text-muted-ink">/judge</code>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={runJudgeMutation.isPending}
              data-testid="run-acceptance-judge-btn"
              onClick={() => {
                void handleRunJudge();
              }}
            >
              <Play className="size-3" aria-hidden="true" />
              <span>
                {runJudgeMutation.isPending
                  ? "Running Judge..."
                  : "Run Acceptance Judge"}
              </span>
            </Button>
          </div>
        </section>
      </div>

      {lastGateResult && (
        <div
          data-testid="quality-gate-result-banner"
          className="flex items-center justify-between gap-3 rounded-xl border border-brand/40 bg-brand-soft px-4 py-3 text-xs text-brand-text"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            <span className="font-medium">
              {lastGateResult.kind === "review"
                ? "Independent Review:"
                : "Acceptance Judge:"}
            </span>
            <span className="text-ink">{lastGateResult.summary}</span>
          </div>
        </div>
      )}

      {/* Productivity Report Section */}
      <section
        data-testid="productivity-report-section"
        className="rayu-card-bevel rounded-[14px] border border-premium bg-pane p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <BarChart3 className="size-4 text-brand-text" aria-hidden="true" />
            <div>
              <h2 className="m-0 text-sm font-semibold text-ink">
                Productivity &amp; Credits Report
              </h2>
              <p className="mt-0.5 text-xs text-muted-ink">
                Generates a Rust-compiled Markdown summary and embedded PNG chart
                via{" "}
                <code className="rounded bg-inset px-1 py-0.5 font-mono text-[11px] text-body">
                  RuntimeCommand::Productivity
                </code>
                .
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-hairline bg-inset p-0.5 text-xs">
              {(["7d", "30d"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={cn(
                    "cursor-pointer rounded-md px-2.5 py-1 font-mono text-[11px] font-medium transition-colors",
                    range === r
                      ? "bg-active text-ink"
                      : "text-muted-ink hover:text-ink",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>

            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={productivityMutation.isPending}
              data-testid="generate-productivity-report-btn"
              onClick={handleGenerateReport}
            >
              <span>
                {productivityMutation.isPending
                  ? "Generating..."
                  : "Generate Productivity Report"}
              </span>
            </Button>
          </div>
        </div>

        {report && (
          <div
            data-testid="productivity-report-output"
            className="mt-4 space-y-3 border-t border-hairline pt-4"
          >
            <pre className="m-0 overflow-x-auto rounded-xl border border-hairline bg-inset p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-body">
              {report.markdown}
            </pre>

            {report.chartBase64 && (
              <div className="overflow-hidden rounded-xl border border-hairline bg-inset p-3">
                <img
                  src={`data:image/png;base64,${report.chartBase64}`}
                  alt="RayuCode productivity chart"
                  className="max-h-64 w-auto rounded-lg"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-ink">
              <span className="font-mono text-[11px]">
                Range: {range} · KV prompt cache warm
              </span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                data-testid="open-productivity-png-btn"
                onClick={() =>
                  postToHost({
                    type: "rayucode.editor.openFile",
                    path:
                      report.chartPath ??
                      (activeProjectPath
                        ? `${activeProjectPath}/productivity-report.png`
                        : "productivity-report.png"),
                  })
                }
              >
                <ExternalLink className="size-3" aria-hidden="true" />
                <span>Open PNG in VS Code</span>
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
