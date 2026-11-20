import type { OrganCode } from "../keys";
import type { Point, Box } from "../../vectors/geometry";
import type { VectorPageExtraction } from "../../vectors/extraction";

export type Location = Point & { sheet: string; generation: string; page: number };
export type Pin = Location & {
    organ: OrganCode | null;
    dn: string | null;
    method: string;
    evidence: string[];
    box?: Box;
    ports?: Point[];
  };
export type Seed = { organ: OrganCode; paths: number[] };
export type Sheet = {
  id: string;
  extraction: VectorPageExtraction;
  generation: string;
  examples: Seed[];
};
export type Poste = {
  id: string;
  organ: OrganCode;
  basis: string;
  discriminants: readonly string[];
  requiresDn: boolean;
};
export type JudgedPin = Pin & { poste: string | null };
export type PageFrame = Omit<Location, keyof Point> & { width: number; height: number };
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
