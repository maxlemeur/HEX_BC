import { resolveNetworkSize } from "../../rules/network-diameters";
import { distanceToSegment, type Point } from "../../vectors/geometry";
import type { NetworkRun } from "../../vectors/measure";
import { printedSize } from "../../vectors/vocabulary";
import { distance } from "./types";

const CONTACT = 0.35;
function nominal(run: NetworkRun) {
  if (run.dn === null || !run.network || run.attached === "conflict") return null;
  const printed = printedSize(run.dn, run.notation);
  if (!run.notation || run.notation === "DN") return printed;
  if (!run.material) return null;
  const size = resolveNetworkSize(printed, run.network, run.material);
  return size.status === "resolved" && size.size.nominal_dn !== null ? "DN " + size.size.nominal_dn : null;
}

export function attachedSize(pin: Point & { ports?: Point[] }, runs: NetworkRun[]) {
  const ports = pin.ports;
  if (!ports || ports.length !== 2) return null;
  const [a, b] = ports,
    span = distance(a, b);
  if (span < 1) return null;
  const ends: NetworkRun[][] = [[], []];
  for (const run of runs) {
    const s = run.segment;
    const endpoints = [
      { x: s.x0, y: s.y0 },
      { x: s.x1, y: s.y1 },
    ];
    let hits = 0;
    for (const [i, port] of ports.entries()) {
      const k = endpoints.findIndex((p) => distance(port, p) <= CONTACT);
      if (k < 0) continue;
      const far = endpoints[1 - k],
        other = ports[1 - i];
      const dot = (far.x - port.x) * (port.x - other.x) + (far.y - port.y) * (port.y - other.y);
      if (dot < 0.96 * distance(port, far) * span) return null;
      ends[i].push(run);
      hits++;
    }
    if (hits > 1) return null;
    if (!hits) {
      // A through-line or a side branch intersects the occupied port span.
      const side = (p: Point) => (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
      const sideRun = (p: Point) => (p.x - s.x0) * (s.y1 - s.y0) - (p.y - s.y0) * (s.x1 - s.x0);
      if (
        (side(endpoints[0]) * side(endpoints[1]) < 0 && sideRun(a) * sideRun(b) < 0) ||
        ports.some((p) => distanceToSegment(p, s) <= CONTACT) ||
        endpoints.some((p) => distanceToSegment(p, { x0: a.x, y0: a.y, x1: b.x, y1: b.y }) <= CONTACT)
      )
        return null;
    }
  }
  if (ends.some((e) => e.length !== 1)) return null;
  const [left, right] = ends.map((e) => e[0]);
  const size = nominal(left);
  return left.network === right.network && size === nominal(right) ? size : null;
}
