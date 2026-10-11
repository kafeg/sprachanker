// A QR code as SVG, made here (uqr, spec 10): dark on white in either theme — a camera reads it so —,
// with its quiet zone; never mirrored right to left.
import { useMemo } from "react";
import { encode } from "uqr";
import { cn } from "./utils.ts";

/** The quiet zone around the code, in modules (the standard's four). */
const QUIET = 4;

export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  /** What it holds, for a screen reader. */
  label: string;
  className?: string;
}) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: QUIET });
    let d = "";
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { size: qr.size, path: d };
  }, [value]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn("rounded-md", className)}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
