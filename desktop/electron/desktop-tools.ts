import type {
  SdkTool,
  SessionToolDefinition,
  ToolResult,
} from "@rayu-dev/rayucode-sdk"

import type { BrowserCdpController } from "./browser-cdp.js"
import {
  createRealPowerPointDeck,
  formatExcelSummaryForAi,
  readRealExcelWorkbook,
  writeRealExcelWorkbook,
  type OfficeExcelWorkbookPayload,
  type OfficePowerPointSlideSpec,
} from "./office-bridge.js"
import {
  readCustomTemplates,
  saveCustomTemplate,
} from "./storage-bridge.js"

export type DesktopArtifactEvent =
  | {
      kind: "slide"
      sessionId?: string
      title: string
      filePath: string
      slides: OfficePowerPointSlideSpec[]
    }
  | {
      kind: "excel"
      sessionId?: string
      workbook: OfficeExcelWorkbookPayload
    }

export interface DesktopToolDeps {
  getWorkspaceDir: () => string
  getWorkspaceDirForSession?: (sessionId?: string) => string
  browserCdp?: BrowserCdpController
  onArtifact?: (artifact: DesktopArtifactEvent) => void
}

export const DESKTOP_TOOL_DEFINITIONS: SessionToolDefinition[] = [
  {
    name: "read_excel",
    description:
      "Read a real .xlsx Microsoft Excel workbook from the workspace or filesystem, returning sheets, cell values, and formulas.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Path to the .xlsx file (relative to workspace or absolute).",
        },
        file_path: {
          type: "string",
          description: "Alias for path.",
        },
      },
    },
  },
  {
    name: "write_excel",
    description:
      "Create or update a real .xlsx Microsoft Excel workbook on disk with worksheets, formatted cells, and real Excel formulas (=SUM, =AVERAGE, etc.).",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Output .xlsx path (relative to workspace or absolute).",
        },
        sheets: {
          type: "array",
          description: "Worksheets to write.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              columns: { type: "array", items: { type: "string" } },
              headers: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: { type: "string" },
                  },
                  {
                    type: "array",
                    items: { type: "string" },
                  },
                ],
                description:
                  "Column headers as an object keyed by column letter (e.g. { A: 'Item', B: 'Cost' }) or an ordered array of header strings.",
              },
              rows: {
                type: "array",
                description:
                  "Rows as objects ({ rowNumber, cells, formulas, formats, isTotal }), header-keyed objects, or value arrays.",
                items: {
                  anyOf: [{ type: "object" }, { type: "array" }],
                },
              },
            },
            required: ["name", "headers", "rows"],
          },
        },
      },
      required: ["file_path", "sheets"],
    },
  },
  {
    name: "create_powerpoint",
    description:
      "Create a real .pptx Microsoft PowerPoint presentation on disk with cover, scorecard KPI cards, bullet slides, and speaker notes.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description:
            "Optional output .pptx path (defaults to ~/.rayu/presentations/<title>.pptx).",
        },
        file_name: {
          type: "string",
          description: "Optional output filename stem.",
        },
        title: {
          type: "string",
          description: "Presentation title.",
        },
        slides: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              kicker: { type: "string" },
              title: { type: "string" },
              subtitle: { type: "string" },
              body: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
              metrics: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    value: { type: "string" },
                    note: { type: "string" },
                  },
                  required: ["label", "value"],
                },
              },
              notes: { type: "string" },
              layout: {
                type: "string",
                enum: ["cover", "scorecard", "bullets"],
              },
            },
            required: ["title", "body"],
          },
        },
      },
      required: ["title", "slides"],
    },
  },
  {
    name: "list_templates",
    description:
      "List saved custom user templates (spreadsheets, presentations, documents) created in RayuCode Desktop so you can follow their structure and styling.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["spreadsheet", "presentation", "document"],
          description: "Optional filter by template kind.",
        },
      },
    },
  },
  {
    name: "save_template",
    description:
      "Save a reusable spreadsheet, presentation, or document template to RayuCode Desktop's persisted template library.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Optional existing template ID to update." },
        kind: {
          type: "string",
          enum: ["spreadsheet", "presentation", "document"],
          description: "Template category.",
        },
        name: { type: "string", description: "Template display name." },
        description: { type: "string", description: "Short summary of the template." },
        prompt_spec: {
          type: "string",
          description: "Detailed template structure, sections, formulas, or styling instructions.",
        },
        promptSpec: {
          type: "string",
          description: "Alias for prompt_spec.",
        },
        accent: {
          type: "string",
          enum: ["emerald", "navy", "amber", "forest", "obsidian"],
          description: "Optional visual accent tag.",
        },
      },
      required: ["kind", "name", "prompt_spec"],
    },
  },
  {
    name: "browser_navigate",
    description:
      "Navigate the embedded right-sidebar real Chromium browser to an internet or localhost URL (auto-opens the Browser panel if closed).",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL or domain to load." },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_snapshot",
    description:
      "Inspect the live embedded browser page via Chrome DevTools Protocol Accessibility Tree, returning compact numbered refs ([e1], [e2]...) for clicking and typing.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "browser_click",
    description:
      "Click an interactive element in the embedded browser using its ref from browser_snapshot (e.g. 'e12').",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element ref from browser_snapshot.",
        },
      },
      required: ["ref"],
    },
  },
  {
    name: "browser_type",
    description:
      "Type text into an input/searchbox in the embedded browser using its ref from browser_snapshot.",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element ref from browser_snapshot.",
        },
        text: { type: "string", description: "Text to type." },
        submit: {
          type: "boolean",
          description: "Press Enter after typing.",
        },
      },
      required: ["ref", "text"],
    },
  },
]

export const DESKTOP_CLOUD_TOOL_SCHEMAS = DESKTOP_TOOL_DEFINITIONS.map(
  (def) => ({
    name: def.name,
    description: def.description,
    input_schema: def.parameters,
  })
)

const DESKTOP_TOOL_NAMES = new Set(DESKTOP_TOOL_DEFINITIONS.map((d) => d.name))

function colIndexToLetter(index: number): string {
  let n = index
  let result = ""
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result || "A"
}

function normalizeExcelSheets(
  rawSheets: unknown[]
): Parameters<typeof writeRealExcelWorkbook>[1]["sheets"] {
  const normalized: Parameters<typeof writeRealExcelWorkbook>[1]["sheets"] = []

  for (let sIdx = 0; sIdx < rawSheets.length; sIdx += 1) {
    const raw = rawSheets[sIdx]
    if (!raw || typeof raw !== "object") continue
    const sheetObj = raw as Record<string, unknown>
    const name =
      typeof sheetObj.name === "string" && sheetObj.name.trim()
        ? sheetObj.name.trim()
        : `Sheet${sIdx + 1}`

    let columns: string[] = []
    const headers: Record<string, string> = {}

    if (Array.isArray(sheetObj.headers)) {
      sheetObj.headers.forEach((h, idx) => {
        const col = colIndexToLetter(idx + 1)
        columns.push(col)
        headers[col] = String(h ?? col)
      })
    } else if (sheetObj.headers && typeof sheetObj.headers === "object") {
      const headerEntries = Object.entries(
        sheetObj.headers as Record<string, unknown>
      )
      for (const [k, v] of headerEntries) {
        headers[k] = String(v ?? k)
      }
      columns =
        Array.isArray(sheetObj.columns) && sheetObj.columns.length > 0
          ? sheetObj.columns.map(String)
          : Object.keys(headers)
    } else if (Array.isArray(sheetObj.columns)) {
      columns = sheetObj.columns.map(String)
      for (const col of columns) {
        headers[col] = col
      }
    }

    const headerNameToCol = new Map<string, string>()
    for (const [col, label] of Object.entries(headers)) {
      headerNameToCol.set(label, col)
      headerNameToCol.set(label.toLowerCase(), col)
    }

    const rawRows = Array.isArray(sheetObj.rows) ? sheetObj.rows : []
    const rows: Parameters<typeof writeRealExcelWorkbook>[1]["sheets"][number]["rows"] =
      []

    for (let rIdx = 0; rIdx < rawRows.length; rIdx += 1) {
      const rawRow = rawRows[rIdx]
      if (Array.isArray(rawRow)) {
        const cells: Record<string, string | number> = {}
        const formulas: Record<string, string> = {}
        rawRow.forEach((val, cIdx) => {
          const col = columns[cIdx] ?? colIndexToLetter(cIdx + 1)
          if (!columns.includes(col)) columns.push(col)
          if (typeof val === "string" && val.trim().startsWith("=")) {
            formulas[col] = val.trim()
            cells[col] = ""
          } else if (typeof val === "number" || typeof val === "string") {
            cells[col] = val
          } else if (val !== null && val !== undefined) {
            cells[col] = String(val)
          }
        })
        rows.push({
          rowNumber: rIdx + 2,
          cells,
          ...(Object.keys(formulas).length > 0 ? { formulas } : {}),
        })
      } else if (rawRow && typeof rawRow === "object") {
        const rowObj = rawRow as Record<string, unknown>
        if (rowObj.cells && typeof rowObj.cells === "object") {
          const cells: Record<string, string | number> = {}
          const formulas: Record<string, string> =
            rowObj.formulas && typeof rowObj.formulas === "object"
              ? { ...(rowObj.formulas as Record<string, string>) }
              : {}
          for (const [k, v] of Object.entries(
            rowObj.cells as Record<string, unknown>
          )) {
            if (typeof v === "string" && v.trim().startsWith("=")) {
              if (!formulas[k]) {
                formulas[k] = v.trim()
              }
              cells[k] = ""
            } else if (typeof v === "number" || typeof v === "string") {
              cells[k] = v
            } else if (v !== null && v !== undefined) {
              cells[k] = String(v)
            }
          }
          rows.push({
            rowNumber:
              typeof rowObj.rowNumber === "number"
                ? rowObj.rowNumber
                : rIdx + 2,
            cells,
            formulas: Object.keys(formulas).length > 0 ? formulas : undefined,
            formats:
              rowObj.formats && typeof rowObj.formats === "object"
                ? (rowObj.formats as Record<
                    string,
                    "currency" | "percent" | "number" | "text"
                  >)
                : undefined,
            isTotal:
              typeof rowObj.isTotal === "boolean" ? rowObj.isTotal : undefined,
          })
        } else {
          // Flat object keyed by column letter or header name
          const cells: Record<string, string | number> = {}
          const formulas: Record<string, string> = {}
          for (const [k, v] of Object.entries(rowObj)) {
            const col =
              k in headers
                ? k
                : (headerNameToCol.get(k) ??
                  headerNameToCol.get(k.toLowerCase()))
            if (!col) continue
            if (typeof v === "string" && v.trim().startsWith("=")) {
              formulas[col] = v.trim()
              cells[col] = ""
            } else if (typeof v === "number" || typeof v === "string") {
              cells[col] = v
            } else if (v !== null && v !== undefined) {
              cells[col] = String(v)
            }
          }
          rows.push({
            rowNumber: rIdx + 2,
            cells,
            ...(Object.keys(formulas).length > 0 ? { formulas } : {}),
          })
        }
      }
    }

    normalized.push({
      name,
      columns: columns.length > 0 ? columns : undefined,
      headers,
      rows,
    })
  }

  return normalized
}

export async function executeDesktopTool(
  deps: DesktopToolDeps,
  name: string,
  args: Record<string, unknown>,
  sessionId?: string,
  signal?: AbortSignal
): Promise<ToolResult | null> {
  if (!DESKTOP_TOOL_NAMES.has(name)) {
    return null
  }
  if (signal?.aborted) {
    return { output: "", error: `Tool "${name}" was aborted.` }
  }

  const workspaceDir =
    deps.getWorkspaceDirForSession?.(sessionId) ?? deps.getWorkspaceDir()

  try {
    switch (name) {
      case "read_excel": {
        const filePath =
          typeof args.path === "string" && args.path.trim()
            ? args.path.trim()
            : typeof args.file_path === "string"
              ? args.file_path.trim()
              : ""
        if (!filePath) return { output: "", error: "path is required" }
        const wb = await readRealExcelWorkbook(workspaceDir, filePath)
        return { output: formatExcelSummaryForAi(wb) }
      }

      case "write_excel": {
        const filePath =
          typeof args.file_path === "string" ? args.file_path.trim() : ""
        const rawSheets = Array.isArray(args.sheets) ? args.sheets : []
        if (!filePath || rawSheets.length === 0) {
          return { output: "", error: "file_path and sheets are required" }
        }
        const sheets = normalizeExcelSheets(rawSheets)
        if (sheets.length === 0) {
          return { output: "", error: "sheets must contain at least one valid sheet" }
        }
        const res = await writeRealExcelWorkbook(workspaceDir, {
          filePath,
          sheets,
        })
        deps.onArtifact?.({
          kind: "excel",
          sessionId,
          workbook: res.workbook,
        })
        return {
          output: `Saved real Excel workbook to ${res.filePath} (${res.sheetCount} sheets, ${res.rowCount} rows).`,
        }
      }

      case "create_powerpoint": {
        const title =
          typeof args.title === "string" && args.title.trim()
            ? args.title.trim()
            : "RayuCode Presentation"
        const slides = Array.isArray(args.slides)
          ? (args.slides as OfficePowerPointSlideSpec[])
          : []
        if (slides.length === 0) {
          return { output: "", error: "slides array is required" }
        }
        const filePath =
          typeof args.file_path === "string" && args.file_path.trim()
            ? args.file_path.trim()
            : undefined
        const fileName =
          typeof args.file_name === "string" && args.file_name.trim()
            ? args.file_name.trim()
            : undefined
        const res = await createRealPowerPointDeck(workspaceDir, {
          filePath,
          fileName,
          title,
          slides,
        })
        deps.onArtifact?.({
          kind: "slide",
          sessionId,
          title: res.title,
          filePath: res.filePath,
          slides: res.slides,
        })
        return {
          output: `Created real PowerPoint deck at ${res.filePath} (${res.slideCount} slides).`,
        }
      }

      case "list_templates": {
        const kindFilter =
          args.kind === "spreadsheet" ||
          args.kind === "presentation" ||
          args.kind === "document"
            ? args.kind
            : undefined
        const templates = readCustomTemplates().filter((t) =>
          kindFilter ? t.kind === kindFilter : true
        )
        if (templates.length === 0) {
          return {
            output: kindFilter
              ? `No saved ${kindFilter} templates found.`
              : "No saved custom templates found.",
          }
        }
        const lines = templates.map(
          (t) =>
            `- [${t.kind}] ${t.name} (id: ${t.id}): ${t.description}\n  Spec: ${t.promptSpec}`
        )
        return { output: lines.join("\n") }
      }

      case "save_template": {
        const kind =
          args.kind === "spreadsheet" ||
          args.kind === "presentation" ||
          args.kind === "document"
            ? args.kind
            : null
        const templateName =
          typeof args.name === "string" ? args.name.trim() : ""
        const promptSpec =
          typeof args.prompt_spec === "string" && args.prompt_spec.trim()
            ? args.prompt_spec.trim()
            : typeof args.promptSpec === "string"
              ? args.promptSpec.trim()
              : ""
        if (!kind || !templateName || !promptSpec) {
          return {
            output: "",
            error: "kind, name, and prompt_spec are required",
          }
        }
        const description =
          typeof args.description === "string" ? args.description : ""
        const accent =
          args.accent === "emerald" ||
          args.accent === "navy" ||
          args.accent === "amber" ||
          args.accent === "forest" ||
          args.accent === "obsidian"
            ? args.accent
            : undefined
        const saved = saveCustomTemplate({
          id: typeof args.id === "string" ? args.id : undefined,
          kind,
          name: templateName,
          description,
          promptSpec,
          accent,
        })
        const created = saved[0]
        return {
          output: `Saved ${kind} template "${created?.name ?? templateName}" (id: ${created?.id ?? "saved"}). Total templates: ${saved.length}.`,
        }
      }

      case "browser_navigate": {
        if (!deps.browserCdp) {
          return { output: "", error: "Embedded browser CDP is unavailable" }
        }
        const url = typeof args.url === "string" ? args.url.trim() : ""
        if (!url) return { output: "", error: "url is required" }
        const res = await deps.browserCdp.navigate(url)
        return res.ok
          ? { output: `Navigated to ${res.url} (${res.title || "loaded"})` }
          : { output: "", error: res.error ?? "Failed to navigate" }
      }

      case "browser_snapshot": {
        if (!deps.browserCdp) {
          return { output: "", error: "Embedded browser CDP is unavailable" }
        }
        const res = await deps.browserCdp.snapshot()
        return res.ok
          ? {
              output: `URL: ${res.url}\nTitle: ${res.title}\nInteractive refs: ${res.refCount}\n\n${res.tree}`,
            }
          : { output: "", error: res.error ?? "Failed to snapshot page" }
      }

      case "browser_click": {
        if (!deps.browserCdp) {
          return { output: "", error: "Embedded browser CDP is unavailable" }
        }
        const ref = typeof args.ref === "string" ? args.ref.trim() : ""
        if (!ref) return { output: "", error: "ref is required" }
        const res = await deps.browserCdp.click(ref)
        return res.ok
          ? { output: res.message }
          : { output: "", error: res.message }
      }

      case "browser_type": {
        if (!deps.browserCdp) {
          return { output: "", error: "Embedded browser CDP is unavailable" }
        }
        const ref = typeof args.ref === "string" ? args.ref.trim() : ""
        const text = typeof args.text === "string" ? args.text : ""
        const submit = Boolean(args.submit)
        if (!ref) return { output: "", error: "ref is required" }
        const res = await deps.browserCdp.type(ref, text, submit)
        return res.ok
          ? { output: res.message }
          : { output: "", error: res.message }
      }

      default:
        return null
    }
  } catch (err) {
    return {
      output: "",
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function buildDesktopSdkTools(deps: DesktopToolDeps): SdkTool[] {
  return DESKTOP_TOOL_DEFINITIONS.map((def) => ({
    ...def,
    execute: async (input, context) => {
      const result = await executeDesktopTool(
        deps,
        def.name,
        input,
        context.sessionId,
        context.signal
      )
      return result ?? { output: "", error: `Unhandled desktop tool: ${def.name}` }
    },
  }))
}
