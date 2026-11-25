import * as React from "react";
import { Loader2, QrCode } from "lucide-react";

import { cn } from "@/lib/utils";

export interface PairingQrMatrixProps {
  value?: string;
  qrSize?: number | null;
  qrPath?: string | null;
  isGenerating?: boolean;
  isExpired?: boolean;
  label?: string;
  sizePx?: number;
  className?: string;
  testId?: string;
}

const GRID_SIZE = 21;

function isFinderCell(row: number, col: number): boolean | null {
  const checkCorner = (r0: number, c0: number): boolean | null => {
    const dr = row - r0;
    const dc = col - c0;
    if (dr < 0 || dr > 6 || dc < 0 || dc > 6) return null;
    if (dr === 0 || dr === 6 || dc === 0 || dc === 6) return true;
    if (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4) return true;
    return false;
  };

  const tl = checkCorner(0, 0);
  if (tl !== null) return tl;
  const tr = checkCorner(0, GRID_SIZE - 7);
  if (tr !== null) return tr;
  const bl = checkCorner(GRID_SIZE - 7, 0);
  if (bl !== null) return bl;

  if (
    (row <= 7 && col <= 7) ||
    (row <= 7 && col >= GRID_SIZE - 8) ||
    (row >= GRID_SIZE - 8 && col <= 7)
  ) {
    return false;
  }

  if (row === 6) return col % 2 === 0;
  if (col === 6) return row % 2 === 0;

  return null;
}

export function buildDeterministicQrMatrix(seed: string): boolean[][] {
  const input = seed.trim() || "rayu://pair";
  const hashes: number[] = [];
  let h1 = 2166136261;
  let h2 = 16777619;

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (Math.imul(h2 ^ code, 2246822519) + i) >>> 0;
    hashes.push(h1 ^ h2);
  }
  if (hashes.length === 0) {
    hashes.push(h1);
  }

  const grid: boolean[][] = [];
  let bitCursor = 0;

  for (let r = 0; r < GRID_SIZE; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < GRID_SIZE; c += 1) {
      const fixed = isFinderCell(r, c);
      if (fixed !== null) {
        row.push(fixed);
      } else {
        const word = hashes[bitCursor % hashes.length] ?? h1;
        const shift = (bitCursor + r * 3 + c * 5) % 29;
        const charCode = input.charCodeAt(bitCursor % input.length) ?? 7;
        const bit = (((word >>> shift) ^ charCode ^ (r * c)) & 1) === 1;
        row.push(bit);
        bitCursor += 1;
      }
    }
    grid.push(row);
  }

  return grid;
}

export function PairingQrMatrix({
  value,
  qrSize,
  qrPath,
  isGenerating = false,
  isExpired = false,
  label = "RayuCode pairing QR matrix",
  sizePx = 156,
  className,
  testId = "pairing-qr-matrix",
}: PairingQrMatrixProps) {
  const fallbackMatrix = React.useMemo(
    () => (value && !qrPath ? buildDeterministicQrMatrix(value) : null),
    [qrPath, value],
  );

  if (isGenerating) {
    return (
      <div
        aria-label="Generating pairing QR code"
        data-testid={`${testId}-loading`}
        className={cn(
          "flex size-[184px] shrink-0 flex-col items-center justify-center gap-2 rounded-[14px] border border-premium bg-inset p-4 text-center",
          className,
        )}
      >
        <Loader2
          className="size-6 animate-spin text-brand-text"
          aria-hidden="true"
        />
        <span className="text-xs font-medium text-body">Generating QR…</span>
      </div>
    );
  }

  if (qrPath && qrSize && !isExpired) {
    return (
      <div
        aria-label={label}
        data-testid={testId}
        data-qr-value={value ?? ""}
        className={cn(
          "flex size-[184px] shrink-0 items-center justify-center rounded-[14px] border border-premium bg-white p-3 shadow-bevel-surface",
          className,
        )}
      >
        <svg
          viewBox={`0 0 ${qrSize} ${qrSize}`}
          width={sizePx}
          height={sizePx}
          shapeRendering="crispEdges"
          role="img"
          aria-label={label}
        >
          <rect width={qrSize} height={qrSize} className="fill-white" />
          <path className="fill-black" d={qrPath} />
        </svg>
      </div>
    );
  }

  if (fallbackMatrix && !isExpired) {
    return (
      <div
        aria-label={label}
        data-testid={testId}
        data-qr-value={value ?? ""}
        className={cn(
          "flex size-[184px] shrink-0 items-center justify-center rounded-[14px] border border-premium bg-white p-3 shadow-bevel-surface",
          className,
        )}
      >
        <svg
          viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
          width={sizePx}
          height={sizePx}
          shapeRendering="crispEdges"
          role="img"
          aria-label={label}
        >
          <rect width={GRID_SIZE} height={GRID_SIZE} className="fill-white" />
          {fallbackMatrix.map((row, rIdx) =>
            row.map((filled, cIdx) =>
              filled ? (
                <rect
                  key={`${rIdx}-${cIdx}`}
                  x={cIdx}
                  y={rIdx}
                  width={1}
                  height={1}
                  className="fill-black"
                />
              ) : null,
            ),
          )}
        </svg>
      </div>
    );
  }

  return (
    <div
      aria-label={isExpired ? "Pairing QR expired" : "No active pairing QR"}
      data-testid={`${testId}-placeholder`}
      className={cn(
        "flex size-[184px] shrink-0 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-premium bg-inset p-4 text-center",
        className,
      )}
    >
      <QrCode className="size-8 text-muted-ink" aria-hidden="true" />
      <span className="text-xs font-medium text-body">
        {isExpired ? "Pairing code expired" : "No active QR"}
      </span>
      <span className="text-[11px] text-muted-ink">
        {isExpired
          ? "Click Regenerate QR to create a new code"
          : "Click Generate QR to start pairing"}
      </span>
    </div>
  );
}
