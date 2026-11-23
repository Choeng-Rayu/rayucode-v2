// Deterministic, zero-dependency Mermaid flowchart/graph parser and hierarchical SVG layout engine.

export type FlowchartDirection = "LR" | "TD" | "RL" | "BT";

export interface ParsedMermaidNode {
  id: string;
  label: string;
  shape: "rect" | "round" | "diamond" | "stadium";
  subgraphId?: string;
}

export interface ParsedMermaidEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export interface ParsedMermaidSubgraph {
  id: string;
  label: string;
  nodeIds: string[];
  accentIndex: number;
}

export interface ParsedMermaidDiagram {
  direction: FlowchartDirection;
  title: string;
  nodes: ParsedMermaidNode[];
  edges: ParsedMermaidEdge[];
  subgraphs: ParsedMermaidSubgraph[];
}

export interface PositionedNode extends ParsedMermaidNode {
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
  accentIndex: number;
}

export interface PositionedSubgraph extends ParsedMermaidSubgraph {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedEdge extends ParsedMermaidEdge {
  pathD: string;
  labelX: number;
  labelY: number;
  isBackEdge: boolean;
}

export interface LaidOutMermaidDiagram {
  width: number;
  height: number;
  title: string;
  direction: FlowchartDirection;
  nodes: PositionedNode[];
  subgraphs: PositionedSubgraph[];
  edges: PositionedEdge[];
}

function stripOuterQuotes(raw: string): string {
  const s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function parseNodeToken(
  token: string,
): { id: string; label?: string; shape: ParsedMermaidNode["shape"] } | null {
  const trimmed = token.trim().replace(/;$/, "");
  if (!trimmed) return null;

  const patterns: Array<{
    regex: RegExp;
    shape: ParsedMermaidNode["shape"];
  }> = [
    { regex: /^([A-Za-z0-9_.-]+)\s*\(\(([\s\S]+?)\)\)$/, shape: "stadium" },
    { regex: /^([A-Za-z0-9_.-]+)\s*\(\[([\s\S]+?)\]\)$/, shape: "stadium" },
    { regex: /^([A-Za-z0-9_.-]+)\s*\[([\s\S]+?)\]$/, shape: "rect" },
    { regex: /^([A-Za-z0-9_.-]+)\s*\(([\s\S]+?)\)$/, shape: "round" },
    { regex: /^([A-Za-z0-9_.-]+)\s*\{([\s\S]+?)\}$/, shape: "diamond" },
  ];

  for (const { regex, shape } of patterns) {
    const m = regex.exec(trimmed);
    if (m) {
      return {
        id: m[1],
        label: stripOuterQuotes(m[2]),
        shape,
      };
    }
  }

  const bare = /^([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (bare) {
    return { id: bare[1], shape: "rect" };
  }
  return null;
}

function splitEdgeChain(line: string): {
  segments: Array<{ nodeToken: string; edgeLabel?: string; dashed?: boolean }>;
} | null {
  const arrowRegex = /\s*(--+>|-\.+->|==+>|--+\s*\|([^|]+)\|\s*--+>|--+>\s*\|([^|]+)\|)\s*/g;
  const matches = Array.from(line.matchAll(arrowRegex));
  if (matches.length === 0) return null;

  const segments: Array<{
    nodeToken: string;
    edgeLabel?: string;
    dashed?: boolean;
  }> = [];
  let cursor = 0;

  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const idx = m.index ?? 0;
    const leftToken = line.slice(cursor, idx).trim();
    const rawArrow = m[1] ?? "";
    const label = (m[2] ?? m[3])?.trim();
    segments.push({
      nodeToken: leftToken,
      edgeLabel: label,
      dashed: rawArrow.includes("."),
    });
    cursor = idx + m[0].length;
  }

  const finalToken = line.slice(cursor).trim();
  segments.push({ nodeToken: finalToken });
  return { segments };
}

export function parseMermaidFlowchart(source: string): ParsedMermaidDiagram {
  const lines = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("%%"));

  let direction: FlowchartDirection = "LR";
  const nodeMap = new Map<string, ParsedMermaidNode>();
  const nodeOrder: string[] = [];
  const edges: ParsedMermaidEdge[] = [];
  const subgraphs: ParsedMermaidSubgraph[] = [];
  const subgraphStack: ParsedMermaidSubgraph[] = [];

  const upsertNode = (
    raw: { id: string; label?: string; shape: ParsedMermaidNode["shape"] },
    currentSubgraph?: ParsedMermaidSubgraph,
  ) => {
    const existing = nodeMap.get(raw.id);
    if (existing) {
      if (raw.label && existing.label === existing.id) {
        existing.label = raw.label;
        existing.shape = raw.shape;
      }
      if (currentSubgraph && !existing.subgraphId) {
        existing.subgraphId = currentSubgraph.id;
        if (!currentSubgraph.nodeIds.includes(raw.id)) {
          currentSubgraph.nodeIds.push(raw.id);
        }
      }
      return;
    }
    const created: ParsedMermaidNode = {
      id: raw.id,
      label: raw.label ?? raw.id,
      shape: raw.shape,
      subgraphId: currentSubgraph?.id,
    };
    nodeMap.set(raw.id, created);
    nodeOrder.push(raw.id);
    if (currentSubgraph && !currentSubgraph.nodeIds.includes(raw.id)) {
      currentSubgraph.nodeIds.push(raw.id);
    }
  };

  for (const line of lines) {
    const headerMatch = /^(?:flowchart|graph)\s+(LR|RL|TD|TB|BT)\b/i.exec(line);
    if (headerMatch) {
      const dir = headerMatch[1].toUpperCase();
      direction = dir === "TB" ? "TD" : (dir as FlowchartDirection);
      continue;
    }

    if (/^end\b/i.test(line)) {
      subgraphStack.pop();
      continue;
    }

    const sgMatch = /^subgraph\s+([A-Za-z0-9_.-]+)?(?:\s*\[([\s\S]+?)\])?(?:\s+(.+))?$/i.exec(
      line,
    );
    if (sgMatch) {
      const rawId = sgMatch[1]?.trim() || `sg_${subgraphs.length + 1}`;
      const rawLabel = sgMatch[2]
        ? stripOuterQuotes(sgMatch[2])
        : sgMatch[3]
          ? stripOuterQuotes(sgMatch[3])
          : stripOuterQuotes(rawId);
      const sg: ParsedMermaidSubgraph = {
        id: rawId,
        label: rawLabel,
        nodeIds: [],
        accentIndex: subgraphs.length % 5,
      };
      subgraphs.push(sg);
      subgraphStack.push(sg);
      continue;
    }

    if (/^(classDef|class|style|linkStyle|click)\b/i.test(line)) {
      continue;
    }

    const currentSg = subgraphStack[subgraphStack.length - 1];
    const chain = splitEdgeChain(line);
    if (chain && chain.segments.length >= 2) {
      const parsedNodes: Array<ReturnType<typeof parseNodeToken>> = [];
      for (const seg of chain.segments) {
        const parsed = parseNodeToken(seg.nodeToken);
        parsedNodes.push(parsed);
        if (parsed) upsertNode(parsed, currentSg);
      }
      for (let i = 0; i < parsedNodes.length - 1; i += 1) {
        const from = parsedNodes[i];
        const to = parsedNodes[i + 1];
        if (!from || !to) continue;
        edges.push({
          id: `e_${edges.length + 1}_${from.id}_${to.id}`,
          from: from.id,
          to: to.id,
          label: chain.segments[i]?.edgeLabel,
          dashed: chain.segments[i]?.dashed,
        });
      }
      continue;
    }

    const solo = parseNodeToken(line);
    if (solo) {
      upsertNode(solo, currentSg);
    }
  }

  const nodes = nodeOrder
    .map((id) => nodeMap.get(id))
    .filter((n): n is ParsedMermaidNode => Boolean(n));

  const title =
    subgraphs.length > 0
      ? `${subgraphs[0].label.split(":")[0].trim()} Architecture`
      : nodes.length > 0
        ? `${nodes[0].label.slice(0, 32)} Flowchart`
        : "Flowchart";

  return {
    direction,
    title,
    nodes,
    edges,
    subgraphs,
  };
}

function wrapLabel(text: string, maxChars = 22): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= maxChars) {
      current = `${current} ${w}`;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

export function layoutMermaidFlowchart(source: string): LaidOutMermaidDiagram {
  const parsed = parseMermaidFlowchart(source);
  const isHorizontal = parsed.direction === "LR" || parsed.direction === "RL";

  if (parsed.nodes.length === 0) {
    return {
      width: 480,
      height: 180,
      title: parsed.title,
      direction: parsed.direction,
      nodes: [],
      subgraphs: [],
      edges: [],
    };
  }

  const rank = new Map<string, number>();
  const nodeOrderIdx = new Map<string, number>();
  parsed.nodes.forEach((n, idx) => {
    rank.set(n.id, 0);
    nodeOrderIdx.set(n.id, idx);
  });

  parsed.subgraphs.forEach((sg, idx) => {
    for (const nid of sg.nodeIds) {
      rank.set(nid, idx * 2);
    }
  });

  const maxPasses = Math.min(parsed.nodes.length + 2, 16);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const edge of parsed.edges) {
      const fromIdx = nodeOrderIdx.get(edge.from) ?? 0;
      const toIdx = nodeOrderIdx.get(edge.to) ?? 0;
      const fromNode = parsed.nodes[fromIdx];
      const toNode = parsed.nodes[toIdx];
      if (
        fromNode?.subgraphId &&
        fromNode.subgraphId === toNode?.subgraphId &&
        toIdx < fromIdx
      ) {
        continue;
      }
      const rFrom = rank.get(edge.from) ?? 0;
      const rTo = rank.get(edge.to) ?? 0;
      if (rTo <= rFrom) {
        rank.set(edge.to, rFrom + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const uniqueRanks = Array.from(new Set(rank.values())).sort((a, b) => a - b);
  const rankRemap = new Map<number, number>();
  uniqueRanks.forEach((r, idx) => rankRemap.set(r, idx));
  for (const [id, r] of rank.entries()) {
    rank.set(id, rankRemap.get(r) ?? 0);
  }

  const columns = new Map<number, ParsedMermaidNode[]>();
  for (const node of parsed.nodes) {
    const r = rank.get(node.id) ?? 0;
    const list = columns.get(r) ?? [];
    list.push(node);
    columns.set(r, list);
  }

  const sgIndexMap = new Map<string, number>();
  parsed.subgraphs.forEach((sg, idx) => sgIndexMap.set(sg.id, idx));

  const marginX = 36;
  const marginY = 44;
  const colGap = 54;
  const rowGap = 24;
  const nodePadX = 16;
  const nodePadY = 12;
  const charW = 7.2;
  const lineH = 16;

  const measured = new Map<
    string,
    { width: number; height: number; lines: string[]; accentIndex: number }
  >();
  for (const node of parsed.nodes) {
    const lines = wrapLabel(node.label, 22);
    const longest = Math.max(...lines.map((l) => l.length), 6);
    const width = Math.max(122, Math.min(208, Math.round(longest * charW + nodePadX * 2)));
    const height = Math.max(44, lines.length * lineH + nodePadY * 2);
    const sgIdx = node.subgraphId ? (sgIndexMap.get(node.subgraphId) ?? 0) : 4;
    measured.set(node.id, { width, height, lines, accentIndex: sgIdx % 5 });
  }

  const positionedNodes = new Map<string, PositionedNode>();
  const totalRanks = uniqueRanks.length;

  if (isHorizontal) {
    const colWidths: number[] = [];
    const colHeights: number[] = [];
    for (let c = 0; c < totalRanks; c += 1) {
      const list = columns.get(c) ?? [];
      colWidths[c] = Math.max(...list.map((n) => measured.get(n.id)!.width), 130);
      colHeights[c] =
        list.reduce((acc, n) => acc + measured.get(n.id)!.height, 0) +
        Math.max(0, list.length - 1) * rowGap;
    }
    const maxColHeight = Math.max(...colHeights, 140);

    let cursorX = marginX;
    for (let c = 0; c < totalRanks; c += 1) {
      const list = columns.get(c) ?? [];
      const colW = colWidths[c];
      const colH = colHeights[c];
      let cursorY = marginY + Math.round((maxColHeight - colH) / 2);

      for (const node of list) {
        const m = measured.get(node.id)!;
        const x = cursorX + Math.round((colW - m.width) / 2);
        positionedNodes.set(node.id, {
          ...node,
          x,
          y: cursorY,
          width: m.width,
          height: m.height,
          lines: m.lines,
          accentIndex: m.accentIndex,
        });
        cursorY += m.height + rowGap;
      }
      cursorX += colW + colGap;
    }
  } else {
    const rowHeights: number[] = [];
    const rowWidths: number[] = [];
    for (let r = 0; r < totalRanks; r += 1) {
      const list = columns.get(r) ?? [];
      rowHeights[r] = Math.max(...list.map((n) => measured.get(n.id)!.height), 48);
      rowWidths[r] =
        list.reduce((acc, n) => acc + measured.get(n.id)!.width, 0) +
        Math.max(0, list.length - 1) * 32;
    }
    const maxRowWidth = Math.max(...rowWidths, 280);

    let cursorY = marginY;
    for (let r = 0; r < totalRanks; r += 1) {
      const list = columns.get(r) ?? [];
      const rowH = rowHeights[r];
      const rowW = rowWidths[r];
      let cursorX = marginX + Math.round((maxRowWidth - rowW) / 2);

      for (const node of list) {
        const m = measured.get(node.id)!;
        const y = cursorY + Math.round((rowH - m.height) / 2);
        positionedNodes.set(node.id, {
          ...node,
          x: cursorX,
          y,
          width: m.width,
          height: m.height,
          lines: m.lines,
          accentIndex: m.accentIndex,
        });
        cursorX += m.width + 32;
      }
      cursorY += rowH + 56;
    }
  }

  const positionedSubgraphs: PositionedSubgraph[] = [];
  for (const sg of parsed.subgraphs) {
    const members = sg.nodeIds
      .map((id) => positionedNodes.get(id))
      .filter((n): n is PositionedNode => Boolean(n));
    if (members.length === 0) continue;
    const minX = Math.min(...members.map((n) => n.x)) - 16;
    const minY = Math.min(...members.map((n) => n.y)) - 34;
    const maxX = Math.max(...members.map((n) => n.x + n.width)) + 16;
    const maxY = Math.max(...members.map((n) => n.y + n.height)) + 16;
    positionedSubgraphs.push({
      ...sg,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
  }

  const allMinX = Math.min(
    ...Array.from(positionedNodes.values()).map((n) => n.x),
    ...positionedSubgraphs.map((s) => s.x),
  );
  const allMinY = Math.min(
    ...Array.from(positionedNodes.values()).map((n) => n.y),
    ...positionedSubgraphs.map((s) => s.y),
  );
  const shiftX = allMinX < 24 ? 24 - allMinX : 0;
  const shiftY = allMinY < 24 ? 24 - allMinY : 0;

  if (shiftX !== 0 || shiftY !== 0) {
    for (const n of positionedNodes.values()) {
      n.x += shiftX;
      n.y += shiftY;
    }
    for (const sg of positionedSubgraphs) {
      sg.x += shiftX;
      sg.y += shiftY;
    }
  }

  const positionedEdges: PositionedEdge[] = [];
  for (const edge of parsed.edges) {
    const from = positionedNodes.get(edge.from);
    const to = positionedNodes.get(edge.to);
    if (!from || !to) continue;

    if (isHorizontal) {
      const isBackEdge = to.x + to.width * 0.5 <= from.x + 2;
      if (isBackEdge) {
        const startX = from.x + from.width / 2;
        const startY = from.y + from.height;
        const endX = to.x + to.width / 2;
        const endY = to.y + to.height;
        const dipY = Math.max(startY, endY) + 34;
        const pathD = `M ${startX} ${startY} C ${startX} ${dipY}, ${endX} ${dipY}, ${endX} ${endY}`;
        positionedEdges.push({
          ...edge,
          pathD,
          labelX: (startX + endX) / 2,
          labelY: dipY - 6,
          isBackEdge: true,
        });
      } else {
        const startX = from.x + from.width;
        const startY = from.y + from.height / 2;
        const endX = to.x;
        const endY = to.y + to.height / 2;
        const dx = Math.max(24, (endX - startX) * 0.48);
        const pathD = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;
        positionedEdges.push({
          ...edge,
          pathD,
          labelX: (startX + endX) / 2,
          labelY: (startY + endY) / 2 - 8,
          isBackEdge: false,
        });
      }
    } else {
      const isBackEdge = to.y + to.height * 0.5 <= from.y + 2;
      const startX = from.x + from.width / 2;
      const startY = isBackEdge ? from.y : from.y + from.height;
      const endX = to.x + to.width / 2;
      const endY = isBackEdge ? to.y + to.height : to.y;
      const dy = Math.max(24, Math.abs(endY - startY) * 0.48);
      const pathD = isBackEdge
        ? `M ${from.x + from.width} ${from.y + from.height / 2} C ${from.x + from.width + 44} ${from.y}, ${to.x + to.width + 44} ${to.y + to.height}, ${to.x + to.width} ${to.y + to.height / 2}`
        : `M ${startX} ${startY} C ${startX} ${startY + dy}, ${endX} ${endY - dy}, ${endX} ${endY}`;
      positionedEdges.push({
        ...edge,
        pathD,
        labelX: (startX + endX) / 2,
        labelY: (startY + endY) / 2,
        isBackEdge,
      });
    }
  }

  const finalNodes = Array.from(positionedNodes.values());
  const maxX = Math.max(
    ...finalNodes.map((n) => n.x + n.width),
    ...positionedSubgraphs.map((s) => s.x + s.width),
    360,
  );
  const maxY = Math.max(
    ...finalNodes.map((n) => n.y + n.height),
    ...positionedSubgraphs.map((s) => s.y + s.height),
    ...positionedEdges.map((e) => (e.isBackEdge ? e.labelY + 24 : 0)),
    180,
  );

  return {
    width: Math.round(maxX + 32),
    height: Math.round(maxY + 32),
    title: parsed.title,
    direction: parsed.direction,
    nodes: finalNodes,
    subgraphs: positionedSubgraphs,
    edges: positionedEdges,
  };
}
