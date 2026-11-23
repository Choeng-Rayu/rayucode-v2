import {
  FileCode2,
  FileSpreadsheet,
  Image as ImageIcon,
  Presentation,
} from "lucide-react"

import { cn } from "@/lib/utils"

interface TechBadgeSpec {
  label: string
  bgClass: string
  fgClass: string
  tracking?: string
}

function resolveTechBadge(filePath: string): TechBadgeSpec | null {
  const lower = filePath.trim().toLowerCase()
  const base = lower.split("/").pop() ?? lower

  if (base === "dockerfile" || base.startsWith("dockerfile.")) {
    return {
      label: "DK",
      bgClass: "bg-tech-react-bg",
      fgClass: "text-tech-react-fg",
    }
  }
  if (base === "cargo.toml" || base === "cargo.lock") {
    return {
      label: "RS",
      bgClass: "bg-tech-rs-bg",
      fgClass: "text-tech-rs-fg",
    }
  }
  if (lower.endsWith(".tsx")) {
    return {
      label: "TX",
      bgClass: "bg-tech-react-bg",
      fgClass: "text-tech-react-fg",
    }
  }
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) {
    return {
      label: "TS",
      bgClass: "bg-tech-ts-bg",
      fgClass: "text-tech-ts-fg",
    }
  }
  if (lower.endsWith(".jsx")) {
    return {
      label: "JX",
      bgClass: "bg-tech-react-bg",
      fgClass: "text-tech-react-fg",
    }
  }
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return {
      label: "JS",
      bgClass: "bg-tech-js-bg",
      fgClass: "text-tech-js-fg",
    }
  }
  if (lower.endsWith(".rs")) {
    return {
      label: "RS",
      bgClass: "bg-tech-rs-bg",
      fgClass: "text-tech-rs-fg",
    }
  }
  if (lower.endsWith(".py")) {
    return {
      label: "PY",
      bgClass: "bg-tech-py-bg",
      fgClass: "text-tech-py-fg",
    }
  }
  if (lower.endsWith(".go")) {
    return {
      label: "GO",
      bgClass: "bg-tech-go-bg",
      fgClass: "text-tech-go-fg",
    }
  }
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) {
    return {
      label: "{}",
      bgClass: "bg-tech-json-bg",
      fgClass: "text-tech-json-fg",
    }
  }
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) {
    return {
      label: "MD",
      bgClass: "bg-tech-md-bg",
      fgClass: "text-tech-md-fg",
    }
  }
  if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".less")) {
    return {
      label: "#",
      bgClass: "bg-tech-css-bg",
      fgClass: "text-tech-css-fg",
    }
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return {
      label: "<>",
      bgClass: "bg-tech-html-bg",
      fgClass: "text-tech-html-fg",
    }
  }
  if (lower.endsWith(".sh") || lower.endsWith(".zsh") || lower.endsWith(".bash")) {
    return {
      label: "$",
      bgClass: "bg-tech-sh-bg",
      fgClass: "text-tech-sh-fg",
    }
  }
  if (lower.endsWith(".sql")) {
    return {
      label: "DB",
      bgClass: "bg-tech-sql-bg",
      fgClass: "text-tech-sql-fg",
    }
  }
  if (lower.endsWith(".yml") || lower.endsWith(".yaml") || lower.endsWith(".toml")) {
    return {
      label: "YM",
      bgClass: "bg-tech-md-bg",
      fgClass: "text-tech-md-fg",
    }
  }
  if (base.startsWith(".env") || base === ".gitignore") {
    return {
      label: "CF",
      bgClass: "bg-active",
      fgClass: "text-muted-ink",
    }
  }
  return null
}

export interface TechFileBadgeProps {
  path: string
  className?: string
}

export function TechFileBadge({ path, className }: TechFileBadgeProps) {
  const lower = path.trim().toLowerCase()

  if (/\.(png|jpg|jpeg|gif|webp|svg|ico)$/.test(lower)) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "grid size-[16px] shrink-0 place-items-center rounded-[3.5px] bg-office-excel-soft text-office-excel",
          className
        )}
      >
        <ImageIcon className="size-2.5" strokeWidth={2} />
      </span>
    )
  }

  if (/\.(xlsx|xlsm|xls|csv)$/.test(lower)) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "grid size-[16px] shrink-0 place-items-center rounded-[3.5px] bg-office-excel-soft text-office-excel",
          className
        )}
      >
        <FileSpreadsheet className="size-2.5" strokeWidth={2} />
      </span>
    )
  }

  if (/\.(pptx|ppt)$/.test(lower)) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "grid size-[16px] shrink-0 place-items-center rounded-[3.5px] bg-office-ppt-soft text-office-ppt",
          className
        )}
      >
        <Presentation className="size-2.5" strokeWidth={2} />
      </span>
    )
  }

  const spec = resolveTechBadge(path)
  if (!spec) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "grid size-[16px] shrink-0 place-items-center rounded-[3.5px] bg-active text-muted-ink",
          className
        )}
      >
        <FileCode2 className="size-2.5" strokeWidth={1.8} />
      </span>
    )
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-[16px] shrink-0 place-items-center rounded-[3.5px] font-mono text-[8.5px] leading-none font-bold tracking-[-0.04em] select-none",
        spec.bgClass,
        spec.fgClass,
        className
      )}
    >
      {spec.label}
    </span>
  )
}
