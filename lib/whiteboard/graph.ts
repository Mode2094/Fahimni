// Deterministic graph-space mapping for the chalkboard graph layer.
// Every graph object uses the lesson schema's [-10,10] coordinate space; the
// renderer maps it into a fixed 100×100 SVG viewBox with padding for labels.

export const GRAPH_MIN = -10;
export const GRAPH_MAX = 10;
export const SVG_SIZE = 100;
export const SVG_PAD = 6;

export type GraphPoint = { x: number; y: number };

export function clampGraphPoint(point: GraphPoint): GraphPoint {
  return {
    x: Math.min(GRAPH_MAX, Math.max(GRAPH_MIN, point.x)),
    y: Math.min(GRAPH_MAX, Math.max(GRAPH_MIN, point.y)),
  };
}

// Graph coordinates (y up) → SVG coordinates (y down).
export function graphToSvg(point: GraphPoint, size = SVG_SIZE, pad = SVG_PAD): GraphPoint {
  const clamped = clampGraphPoint(point);
  const span = GRAPH_MAX - GRAPH_MIN;
  const scale = (size - pad * 2) / span;
  return {
    x: pad + (clamped.x - GRAPH_MIN) * scale,
    y: size - pad - (clamped.y - GRAPH_MIN) * scale,
  };
}

// A plotted line must be ordered by x so the polyline never zig-zags.
export function orderLine(points: GraphPoint[]): GraphPoint[] {
  return [...points].sort((a, b) => a.x - b.x);
}

export function polylinePath(points: GraphPoint[], size = SVG_SIZE, pad = SVG_PAD): string {
  if (points.length < 2) return '';
  return points
    .map((point, index) => {
      const svg = graphToSvg(point, size, pad);
      return `${index === 0 ? 'M' : 'L'} ${svg.x.toFixed(2)} ${svg.y.toFixed(2)}`;
    })
    .join(' ');
}

export function segmentPath(from: GraphPoint, to: GraphPoint, size = SVG_SIZE, pad = SVG_PAD): string {
  const a = graphToSvg(from, size, pad);
  const b = graphToSvg(to, size, pad);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export function arrowHeadPath(from: GraphPoint, to: GraphPoint, size = SVG_SIZE, pad = SVG_PAD, head = 5): string {
  const a = graphToSvg(from, size, pad);
  const b = graphToSvg(to, size, pad);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const left = { x: b.x - head * Math.cos(angle - Math.PI / 7), y: b.y - head * Math.sin(angle - Math.PI / 7) };
  const right = { x: b.x - head * Math.cos(angle + Math.PI / 7), y: b.y - head * Math.sin(angle + Math.PI / 7) };
  return `M ${left.x.toFixed(2)} ${left.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)} L ${right.x.toFixed(2)} ${right.y.toFixed(2)}`;
}

// Integer ticks across the visible range; labels only at the extremes and the
// origin so the small mobile board stays readable.
export function axisTicks(step = 5): number[] {
  const ticks: number[] = [];
  for (let value = GRAPH_MIN; value <= GRAPH_MAX; value += step) ticks.push(value);
  return ticks;
}

export function isGraphPoint(value: unknown): value is GraphPoint {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isFinite((value as GraphPoint).x) &&
    Number.isFinite((value as GraphPoint).y) &&
    Math.abs((value as GraphPoint).x) <= GRAPH_MAX &&
    Math.abs((value as GraphPoint).y) <= GRAPH_MAX
  );
}
