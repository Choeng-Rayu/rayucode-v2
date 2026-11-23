import * as React from "react";
import { Maximize2, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  layoutMermaidFlowchart,
  type PositionedNode,
} from "@/lib/mermaid-flowchart";
import { cn } from "@/lib/utils";

const SUBGRAPH_PALETTES = [
  {
    fill: "var(--info-soft)",
    stroke: "var(--code-fn)",
    label: "var(--code-fn)",
  },
  {
    fill: "var(--pk-edit)",
    stroke: "var(--code-type)",
    label: "var(--code-type)",
  },
  {
    fill: "var(--accent-soft)",
    stroke: "var(--accent)",
    label: "var(--accent-text)",
  },
  {
    fill: "var(--folder-soft)",
    stroke: "var(--folder)",
    label: "var(--folder)",
  },
  {
    fill: "var(--pk-think)",
    stroke: "var(--code-num)",
    label: "var(--code-num)",
  },
] as const;

export interface MermaidDiagramSvgProps {
  source: string;
  zoom?: number;
  expandable?: boolean;
  onNodeClick?: (node: PositionedNode) => void;
  className?: string;
  svgRef?: React.Ref<SVGSVGElement>;
}

function MermaidSvgCanvas({
  source,
  zoom = 1,
  onNodeClick,
  svgRef,
}: {
  source: string;
  zoom: number;
  onNodeClick?: (node: PositionedNode) => void;
  svgRef?: React.Ref<SVGSVGElement>;
}) {
  const markerId = React.useId().replace(/:/g, "");
  const layout = React.useMemo(() => layoutMermaidFlowchart(source), [source]);

  if (layout.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-xs text-muted-ink">
        No flowchart nodes detected in Mermaid source.
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label={layout.title}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={{
        width: `${Math.round(layout.width * zoom)}px`,
        height: `${Math.round(layout.height * zoom)}px`,
        minWidth: "100%",
      }}
      className="mx-auto block select-none"
    >
      <defs>
        <marker
          id={`arrow-${markerId}`}
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="6.5"
          markerHeight="6.5"
          orient="auto-start-reverse"
        >
          <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill="var(--text-3)" />
        </marker>
        <marker
          id={`arrow-accent-${markerId}`}
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="6.5"
          markerHeight="6.5"
          orient="auto-start-reverse"
        >
          <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill="var(--accent)" />
        </marker>
      </defs>

      {layout.subgraphs.map((sg) => {
        const palette =
          SUBGRAPH_PALETTES[sg.accentIndex % SUBGRAPH_PALETTES.length];
        return (
          <g key={sg.id} data-subgraph-id={sg.id}>
            <rect
              x={sg.x}
              y={sg.y}
              width={sg.width}
              height={sg.height}
              rx={12}
              fill={palette.fill}
              fillOpacity={0.42}
              stroke={palette.stroke}
              strokeOpacity={0.38}
              strokeWidth={1.25}
            />
            <text
              x={sg.x + 12}
              y={sg.y + 19}
              fill={palette.label}
              fontSize={11}
              fontWeight={600}
              fontFamily="var(--font-ui)"
            >
              {sg.label}
            </text>
          </g>
        );
      })}

      {layout.edges.map((edge) => (
        <g key={edge.id}>
          <path
            d={edge.pathD}
            fill="none"
            stroke={edge.isBackEdge ? "var(--accent)" : "var(--text-3)"}
            strokeOpacity={edge.isBackEdge ? 0.8 : 0.72}
            strokeWidth={1.5}
            strokeDasharray={
              edge.dashed || edge.isBackEdge ? "4 3" : undefined
            }
            markerEnd={
              edge.isBackEdge
                ? `url(#arrow-accent-${markerId})`
                : `url(#arrow-${markerId})`
            }
          />
          {edge.label ? (
            <g>
              <rect
                x={edge.labelX - edge.label.length * 3.4 - 6}
                y={edge.labelY - 9}
                width={edge.label.length * 6.8 + 12}
                height={16}
                rx={4}
                fill="var(--bg-pane)"
                stroke="var(--border)"
                strokeWidth={0.8}
              />
              <text
                x={edge.labelX}
                y={edge.labelY + 2.5}
                textAnchor="middle"
                fill="var(--text-2)"
                fontSize={10}
                fontFamily="var(--font-mono)"
              >
                {edge.label}
              </text>
            </g>
          ) : null}
        </g>
      ))}

      {layout.nodes.map((node) => {
        const palette =
          SUBGRAPH_PALETTES[node.accentIndex % SUBGRAPH_PALETTES.length];
        const rx =
          node.shape === "stadium"
            ? node.height / 2
            : node.shape === "round"
              ? 12
              : 9;
        const startTextY =
          node.y +
          node.height / 2 -
          ((node.lines.length - 1) * 15) / 2 +
          4;

        return (
          <g
            key={node.id}
            data-node-id={node.id}
            onClick={onNodeClick ? () => onNodeClick(node) : undefined}
            className={onNodeClick ? "cursor-pointer" : undefined}
          >
            <rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx={rx}
              fill="var(--bg-raised)"
              stroke={palette.stroke}
              strokeOpacity={0.55}
              strokeWidth={1.25}
            />
            <rect
              x={node.x + 1}
              y={node.y + 6}
              width={3}
              height={Math.max(12, node.height - 12)}
              rx={1.5}
              fill={palette.stroke}
            />
            {node.lines.map((line, lineIdx) => (
              <text
                key={lineIdx}
                x={node.x + node.width / 2 + 2}
                y={startTextY + lineIdx * 15}
                textAnchor="middle"
                fill="var(--text-1)"
                fontSize={11.5}
                fontWeight={500}
                fontFamily="var(--font-ui)"
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function MermaidDiagramSvg({
  source,
  zoom = 1,
  expandable = true,
  onNodeClick,
  className,
  svgRef,
}: MermaidDiagramSvgProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [modalZoom, setModalZoom] = React.useState(1);

  return (
    <>
      <div
        data-slot="mermaid-svg-viewport"
        className={cn(
          "group/mermaid relative w-full overflow-auto rounded-lg border border-hairline-soft bg-inset/60 p-3",
          className,
        )}
      >
        {expandable && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Expand diagram"
            onClick={() => {
              setModalZoom(1);
              setExpanded(true);
            }}
            className="absolute top-2 right-2 z-10 bg-pane/90 opacity-0 transition-opacity group-hover/mermaid:opacity-100 focus-visible:opacity-100"
          >
            <Maximize2 className="size-3" />
          </Button>
        )}
        <MermaidSvgCanvas
          source={source}
          zoom={zoom}
          onNodeClick={onNodeClick}
          svgRef={svgRef}
        />
      </div>

      {expandable && (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="max-w-4xl p-4">
            <DialogHeader className="flex flex-row items-center justify-between pr-8">
              <DialogTitle className="text-sm">Diagram Viewer</DialogTitle>
              <div className="inline-flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Zoom out"
                  onClick={() =>
                    setModalZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))
                  }
                >
                  <ZoomOut className="size-3.5" />
                </Button>
                <span className="min-w-10 text-center font-mono text-[11px] text-muted-ink tabular-nums">
                  {Math.round(modalZoom * 100)}%
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Zoom in"
                  onClick={() =>
                    setModalZoom((z) => Math.min(2.2, Math.round((z + 0.15) * 100) / 100))
                  }
                >
                  <ZoomIn className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Reset zoom"
                  onClick={() => setModalZoom(1)}
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              </div>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-hairline bg-inset p-4">
              <MermaidSvgCanvas
                source={source}
                zoom={modalZoom}
                onNodeClick={onNodeClick}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
