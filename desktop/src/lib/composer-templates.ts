import type { PersistedComposerTemplate } from "./ipc-client"

export type ComposerTemplateKind = "spreadsheet" | "presentation" | "document"

export type TemplatePreviewVariant =
  | "sheet-analytics"
  | "sheet-budget"
  | "sheet-calendar"
  | "sheet-saas"
  | "slide-market"
  | "slide-operating"
  | "slide-kickoff"
  | "slide-architecture"
  | "custom"

export interface ClarifyingOption {
  key: "1" | "2" | "3"
  id: "provide_data" | "repo_overview" | "blank_template"
  title: string
  subtitle: string
  recommended?: boolean
}

export interface ClarifyingQuestionSpec {
  prompt: string
  options: ClarifyingOption[]
  placeholder: string
}

export interface ComposerTemplateItem {
  id: string
  kind: ComposerTemplateKind
  name: string
  description: string
  previewVariant: TemplatePreviewVariant
  accent: "emerald" | "navy" | "amber" | "forest" | "obsidian"
  promptSpec: string
  clarifyingQuestion: ClarifyingQuestionSpec
  isCustom?: boolean
}

export const BUILTIN_SPREADSHEET_TEMPLATES: ComposerTemplateItem[] = [
  {
    id: "tpl_analytics_dashboard",
    kind: "spreadsheet",
    name: "Analytics Dashboard",
    description: "KPI summary, active users, MRR, and actual-vs-target trend",
    previewVariant: "sheet-analytics",
    accent: "navy",
    promptSpec:
      "Create an Excel workbook (.xlsx) with an executive Analytics Dashboard sheet featuring KPI summary tiles (Active Users, New Users, Sessions/User, Monthly Recurring Revenue), a structured Monthly Actuals vs Target data tab, and live Excel formulas (SUM, AVERAGE, growth delta %).",
    clarifyingQuestion: {
      prompt:
        "What should the Analytics Dashboard workbook be based on? Include the reporting period, key KPIs, and target benchmarks you want tracked.",
      placeholder: "No, and tell RayuCode what to do differently",
      options: [
        {
          key: "1",
          id: "provide_data",
          title: "I'll provide data",
          subtitle:
            "Use a CSV, export, or metrics table you'll provide as the factual basis.",
          recommended: true,
        },
        {
          key: "2",
          id: "repo_overview",
          title: "Repository overview",
          subtitle:
            "Derive product & telemetry KPIs from workspace analytics code and mark live values as placeholders.",
        },
        {
          key: "3",
          id: "blank_template",
          title: "Blank template",
          subtitle:
            "Return the formatted workbook structure with formulas and yellow input cells, without fabricated data.",
        },
      ],
    },
  },
  {
    id: "tpl_financial_budget",
    kind: "spreadsheet",
    name: "Financial Budget",
    description: "Scenario selector, FY bookings, revenue recognition & EBITDA",
    previewVariant: "sheet-budget",
    accent: "emerald",
    promptSpec:
      "Create a Financial Budget and Forecast workbook (.xlsx) with a Summary tab (Selected Scenario: Base/Upside/Downside, FY Bookings, FY Recognized Revenue, Monthly Outlook table with Bookings, Recognized Revenue, EBITDA, Ending Cash) and formula-driven Assumptions & Headcount tabs.",
    clarifyingQuestion: {
      prompt:
        "What should the Financial Budget and Forecast be based on? Include the fiscal year, currency, scenarios, and key revenue or cost drivers.",
      placeholder: "No, and tell RayuCode what to do differently",
      options: [
        {
          key: "1",
          id: "provide_data",
          title: "I'll provide data",
          subtitle:
            "Use actuals, a P&L export, or budget inputs you'll provide as the factual basis.",
          recommended: true,
        },
        {
          key: "2",
          id: "repo_overview",
          title: "Repository overview",
          subtitle:
            "Model unit costs and pricing tiers from repository configuration and mark actuals as unavailable.",
        },
        {
          key: "3",
          id: "blank_template",
          title: "Blank template",
          subtitle:
            "Return the multi-tab budget template with dynamic Excel formulas and empty input cells.",
        },
      ],
    },
  },
  {
    id: "tpl_operating_calendar",
    kind: "spreadsheet",
    name: "Operating Calendar",
    description: "Annual planning calendar by quarter with milestones & owners",
    previewVariant: "sheet-calendar",
    accent: "amber",
    promptSpec:
      "Create an Annual Operating Calendar workbook (.xlsx) with dynamic year control, Q1-Q4 monthly calendar grids, milestone color coding, launch deadlines, and an owners/deliverables tracker tab linked via formulas.",
    clarifyingQuestion: {
      prompt:
        "What should the Operating Calendar cover? Include the target year, cadence (launches, reviews, sprints), and key milestone dates.",
      placeholder: "No, and tell RayuCode what to do differently",
      options: [
        {
          key: "1",
          id: "provide_data",
          title: "I'll provide data",
          subtitle:
            "Use a roadmap, sprint schedule, or milestone list you'll provide.",
          recommended: true,
        },
        {
          key: "2",
          id: "repo_overview",
          title: "Repository overview",
          subtitle:
            "Build a release & engineering cadence calendar from repository milestones and docs.",
        },
        {
          key: "3",
          id: "blank_template",
          title: "Blank template",
          subtitle:
            "Return the annual Q1-Q4 calendar grid ready for dates and milestones.",
        },
      ],
    },
  },
  {
    id: "tpl_saas_cohort",
    kind: "spreadsheet",
    name: "SaaS Metrics Model",
    description: "ARR bridge, NRR retention cohorts, and CAC payback",
    previewVariant: "sheet-saas",
    accent: "forest",
    promptSpec:
      "Create a SaaS Metrics Model workbook (.xlsx) with ARR Waterfall (New, Expansion, Contraction, Churned), Monthly Cohort Retention matrix, and Unit Economics (CAC, LTV, Gross Margin, Payback Months) driven by clean Excel formulas.",
    clarifyingQuestion: {
      prompt:
        "What should the SaaS Metrics Model be based on? Include cohort timeframe, pricing plans, and any baseline ARR or churn numbers.",
      placeholder: "No, and tell RayuCode what to do differently",
      options: [
        {
          key: "1",
          id: "provide_data",
          title: "I'll provide data",
          subtitle:
            "Use billing exports, Stripe data, or cohort tables you'll provide.",
          recommended: true,
        },
        {
          key: "2",
          id: "repo_overview",
          title: "Repository overview",
          subtitle:
            "Align plan tiers and billing events from the repository schema with empty actuals.",
        },
        {
          key: "3",
          id: "blank_template",
          title: "Blank template",
          subtitle:
            "Return the formula-ready ARR bridge and cohort matrix with clean placeholders.",
        },
      ],
    },
  },
]

export const BUILTIN_PRESENTATION_TEMPLATES: ComposerTemplateItem[] = [
  {
    id: "tpl_market_trends",
    kind: "presentation",
    name: "Market Trends Report",
    description: "Editorial dark deck covering industry signals & strategy",
    previewVariant: "slide-market",
    accent: "obsidian",
    promptSpec:
      "Create a polished Market Industry Trends Report presentation deck covering Executive Summary, Macro Market Signals, Competitive Shifts, Customer Implications, Strategic Bets, and 12-Month Roadmap with speaker notes.",
    clarifyingQuestion: {
      prompt:
        "What should the Market Trends Report deck be based on? Include the industry, target timeframe, audience, and strategic questions to answer.",
      placeholder: "No, and tell RayuCode what to do differently",
      options: [
        {
          key: "1",
          id: "provide_data",
          title: "I'll provide data",
          subtitle:
            "Use research notes, analyst reports, or source files you'll provide as the factual basis.",
          recommended: true,
        },
        {
          key: "2",
          id: "repo_overview",
          title: "Repository overview",
          subtitle:
            "Frame product positioning from repository docs and mark external market figures as needing citations.",
        },
        {
          key: "3",
          id: "blank_template",
          title: "Blank template",
          subtitle:
            "Return the slide structure and visual layout with placeholders, without market claims.",
        },
      ],
    },
  },
  {
    id: "tpl_operating_review",
    kind: "presentation",
    name: "Operating Review",
    description: "Weekly or quarterly business operating review deck",
    previewVariant: "slide-operating",
    accent: "navy",
    promptSpec:
      "Create a Weekly Business Operating Review presentation deck featuring Title & Review Period, Executive Scorecard, Key Wins & Shipped Milestones, Metric Deep Dive, Risks & Blockers, Decisions Needed, and Next Period Priorities.",
    clarifyingQuestion: {
      prompt:
        "What should the Business Review deck be based on? Include the review period, audience, and any metrics or decisions you want highlighted.",
      placeholder: "No, and tell RayuCode what to do differently",
      options: [
        {
          key: "1",
          id: "provide_data",
          title: "I'll provide data",
          subtitle:
            "Use a brief, spreadsheet, or source files you'll provide as the factual basis.",
          recommended: true,
        },
        {
          key: "2",
          id: "repo_overview",
          title: "Repository overview",
          subtitle:
            "Build a company/product review from repository materials and mark business metrics as unavailable.",
        },
        {
          key: "3",
          id: "blank_template",
          title: "Blank template",
          subtitle:
            "Return the template structure with placeholders, without business claims.",
        },
      ],
    },
  },
  {
    id: "tpl_project_kickoff",
    kind: "presentation",
    name: "Project Kickoff",
    description: "Aligning team vision, milestones, owners, and success criteria",
    previewVariant: "slide-kickoff",
    accent: "forest",
    promptSpec:
      "Create a Team Project Kickoff Session presentation deck covering Project Vision & Goals, Scope & Non-Goals, System Plan & Architecture, Milestones & Timeline, Roles & Ownership, Risks & Mitigations, and Immediate Next Steps.",
    clarifyingQuestion: {
      prompt:
        "What should the Project Kickoff deck be based on? Include the initiative name, team audience, launch target, and key deliverables.",
      placeholder: "No, and tell RayuCode what to do differently",
      options: [
        {
          key: "1",
          id: "provide_data",
          title: "I'll provide data",
          subtitle:
            "Use a PRD, design doc, or project brief you'll provide as the factual basis.",
          recommended: true,
        },
        {
          key: "2",
          id: "repo_overview",
          title: "Repository overview",
          subtitle:
            "Build the kickoff deck directly from repository specs, architecture, and open milestones.",
        },
        {
          key: "3",
          id: "blank_template",
          title: "Blank template",
          subtitle:
            "Return the kickoff slide framework with placeholders ready for team fill-in.",
        },
      ],
    },
  },
  {
    id: "tpl_architecture_review",
    kind: "presentation",
    name: "Architecture Review",
    description: "System topology, trade-offs, reliability & scaling plan",
    previewVariant: "slide-architecture",
    accent: "navy",
    promptSpec:
      "Create a Technical Architecture Deep Dive presentation deck covering Problem Context, System Topology, Data & Control Flows, Key Trade-offs, Failure Modes & Reliability, Performance Budgets, and Rollout Plan.",
    clarifyingQuestion: {
      prompt:
        "What should the Architecture Review deck focus on? Include the system/service, target audience, and key technical decisions to review.",
      placeholder: "No, and tell RayuCode what to do differently",
      options: [
        {
          key: "1",
          id: "provide_data",
          title: "I'll provide data",
          subtitle:
            "Use an RFC, ADR, or benchmark results you'll provide as the source.",
          recommended: true,
        },
        {
          key: "2",
          id: "repo_overview",
          title: "Repository overview",
          subtitle:
            "Inspect the active repository modules and architecture to generate an accurate technical deck.",
        },
        {
          key: "3",
          id: "blank_template",
          title: "Blank template",
          subtitle:
            "Return the architecture review slide structure with diagram placeholders.",
        },
      ],
    },
  },
]

export function mapCustomTemplateToItem(
  tpl: PersistedComposerTemplate
): ComposerTemplateItem {
  const artifactLabel =
    tpl.kind === "spreadsheet"
      ? "workbook"
      : tpl.kind === "presentation"
        ? "deck"
        : "document"
  return {
    id: tpl.id,
    kind: tpl.kind,
    name: tpl.name,
    description: tpl.description,
    previewVariant: "custom",
    accent: tpl.accent,
    promptSpec: tpl.promptSpec,
    isCustom: true,
    clarifyingQuestion: {
      prompt: `What should the "${tpl.name}" ${artifactLabel} be based on? Include any context, audience, or source files you want highlighted.`,
      placeholder: "No, and tell RayuCode what to do differently",
      options: [
        {
          key: "1",
          id: "provide_data",
          title: "I'll provide data",
          subtitle:
            "Use a brief, spreadsheet, or source files you'll provide as the factual basis.",
          recommended: true,
        },
        {
          key: "2",
          id: "repo_overview",
          title: "Repository overview",
          subtitle:
            "Generate content grounded in the current repository and mark missing business metrics as unavailable.",
        },
        {
          key: "3",
          id: "blank_template",
          title: "Blank template",
          subtitle:
            "Return the reusable template structure with clean placeholders.",
        },
      ],
    },
  }
}

export function buildTemplatePrompt(input: {
  template: ComposerTemplateItem
  selectedOption?: ClarifyingOption | null
  customInstruction?: string
}): string {
  const { template, selectedOption, customInstruction } = input
  const lines = [
    `[Template: ${template.name} (${template.kind})]`,
    template.promptSpec,
  ]

  if (selectedOption) {
    lines.push(
      `Data basis: ${selectedOption.title} — ${selectedOption.subtitle}`
    )
  } else if (customInstruction?.trim()) {
    lines.push(`User instructions: ${customInstruction.trim()}`)
  } else {
    lines.push(
      "Proceed directly with sensible structure and clear placeholders where live data is not supplied."
    )
  }

  return lines.join("\n\n")
}
