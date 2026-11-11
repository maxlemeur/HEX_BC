import { describe, expect, it } from "vitest";

import { CadReadError } from "./dxf";
import { readIfc, type IfcModel, type IfcRow } from "./ifc";
import { boilerRoomIfc, ifcFile, ifcText } from "./ifc.test-utils";

const encode = (text: string) => new TextEncoder().encode(text);

/** The rows of a class, with the names their numbers stand for. */
function rowsOf(model: IfcModel, cls: string) {
  return model.rows
    .filter((row) => model.classes[row.cls] === cls)
    .map((row) => ({ ...row, cls, storey: row.storey < 0 ? null : model.storeys[row.storey].name }));
}

function row(model: IfcModel, cls: string, type: string): Omit<IfcRow, "cls" | "storey"> & { cls: string; storey: string | null } {
  const found = rowsOf(model, cls).filter((candidate) => candidate.type === type);
  expect(found).toHaveLength(1);
  return found[0];
}

async function failure(bytes: Uint8Array): Promise<unknown> {
  return readIfc(bytes).then(() => null, (error: unknown) => error);
}

describe("readIfc", () => {
  it("reads the schema, the software, the storeys from the lowest and the classes of the elements", async () => {
    const model = await readIfc(boilerRoomIfc());

    expect(model.schema).toBe("IFC4");
    expect(model.application).toBe("Atelier fictif 1.0");
    expect(model.storeys).toEqual([{ name: "Sous-sol", elevation: -3 }, { name: "Rez-de-chaussée", elevation: 0 }]);
    expect(model.classes).toEqual(["IfcDuctSegment", "IfcPipeFitting", "IfcPipeSegment", "IfcSanitaryTerminal", "IfcWall"]);
    // The opening of the wall and the room are not things to count.
    expect(model.elements).toBe(12);
    expect(model.counted).toBe(12);
    expect(model.truncated).toEqual({ elements: false, rows: false, geometry: false, apart: false });
  });

  it("counts the elements by class, type, section and storey", async () => {
    const model = await readIfc(boilerRoomIfc());

    expect(rowsOf(model, "IfcPipeSegment").map(({ type, section, storey, count }) => ({ type, section, storey, count }))).toEqual([
      { type: "Collecteur:Fonte", section: [160], storey: null, count: 1 },
      { type: "Flexible:Raccordement", section: null, storey: "Sous-sol", count: 1 },
      { type: "Tuyau cuivre:Alimentation", section: [40], storey: "Sous-sol", count: 1 },
      { type: "Tuyau PVC:Évacuation", section: [110], storey: "Rez-de-chaussée", count: 3 },
    ]);
    expect(row(model, "IfcPipeFitting", "Coude PVC:87°")).toMatchObject({ storey: "Rez-de-chaussée", count: 2, lengths: 0, length: 0 });
    expect(row(model, "IfcSanitaryTerminal", "Lavabo:Standard")).toMatchObject({ storey: "Rez-de-chaussée", count: 1, lengths: 0 });
  });

  it("reads the run of a pipe in its shape: the depth of its extrusion, even shorter than the pipe is wide", async () => {
    const model = await readIfc(boilerRoomIfc());

    const drains = row(model, "IfcPipeSegment", "Tuyau PVC:Évacuation");
    expect(drains).toMatchObject({ lengths: 3, stated: 0, approximate: 0 });
    // 4,25 m, 1,75 m and a stub of 60 mm on a pipe of 110 mm.
    expect(drains.length).toBeCloseTo(6.06, 6);
    expect(row(model, "IfcPipeSegment", "Tuyau cuivre:Alimentation").length).toBeCloseTo(2, 6);
  });

  it("takes as the run of an extruded rectangle the side its ports are apart by, and its longest side without ports", async () => {
    // Revit draws a duct by its plan, extruded by its height: the run is a side of the profile, not the depth.
    // One duct of 3 m has no port; a stub of 250 mm of the same duct, 400 mm wide, has its two.
    const duct = row(await readIfc(boilerRoomIfc()), "IfcDuctSegment", "Gaine rectangulaire:Soufflage");

    expect(duct).toMatchObject({ section: [400, 350], storey: "Sous-sol", count: 2, lengths: 2, approximate: 0 });
    expect(duct.length).toBeCloseTo(3.25, 6);
  });

  it("keeps the longest side as the run when the ports are apart by none of the sides", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      const placement = ifc.placement([0, 0, 0]);
      const duct = ifc.element("IFCDUCTSEGMENT", { name: "Gaine", objectType: "Gaine", placement, shape: ifc.shape([ifc.extrusion(ifc.rectangle(900, 300), 200)]) });
      ifc.ports(duct, placement, [[0, 0, 0], [0, 0, 0], [40, 0, 0]]);
    }));

    expect(row(model, "IfcDuctSegment", "Gaine")).toMatchObject({ section: [300, 200], lengths: 1 });
    expect(row(model, "IfcDuctSegment", "Gaine").length).toBeCloseTo(0.9, 6);
  });

  it("measures on its faces a segment that is not an extrusion, and says that this length is approximate", async () => {
    const hose = row(await readIfc(boilerRoomIfc()), "IfcPipeSegment", "Flexible:Raccordement");

    expect(hose).toMatchObject({ section: null, lengths: 1, approximate: 1, stated: 0 });
    // A box of 1,2 m, turned in the plan: neither its width nor its depth in the model.
    expect(hose.length).toBeCloseTo(1.2, 3);
  });

  it("prefers the length the file declares in its base quantities to the one of the shape", async () => {
    const collector = row(await readIfc(boilerRoomIfc()), "IfcPipeSegment", "Collecteur:Fonte");

    expect(collector).toMatchObject({ lengths: 1, stated: 1, approximate: 0, section: [160] });
    expect(collector.length).toBeCloseTo(3.1, 6);
  });

  it("reads the length, the area and the volume declared for a wall, and measures nothing on it", async () => {
    const wall = row(await readIfc(boilerRoomIfc()), "IfcWall", "");

    expect(wall).toMatchObject({ count: 1, lengths: 1, stated: 1, areas: 1, volumes: 1, section: null });
    expect(wall.length).toBeCloseTo(5, 6);
    // The net side area, not the gross one.
    expect(wall.area).toBeCloseTo(13.14, 6);
    expect(wall.volume).toBeCloseTo(2.628, 6);
  });

  it("reads an IFC2X3 model, whose pipes and ducts are all flow segments", async () => {
    const model = await readIfc(boilerRoomIfc({ schema: "IFC2X3" }));

    expect(model.schema).toBe("IFC2X3");
    expect(model.classes).toEqual(["IfcFlowFitting", "IfcFlowSegment", "IfcFlowTerminal", "IfcWallStandardCase"]);
    expect(model.elements).toBe(12);
    expect(rowsOf(model, "IfcFlowSegment").map(({ type, section, count, length }) => [type, section, count, Math.round(length * 1000)])).toEqual([
      ["Collecteur:Fonte", [160], 1, 3100],
      ["Flexible:Raccordement", null, 1, 1200],
      ["Gaine rectangulaire:Soufflage", [400, 350], 2, 3250],
      ["Tuyau cuivre:Alimentation", [40], 1, 2000],
      ["Tuyau PVC:Évacuation", [110], 3, 6060],
    ]);
    expect(row(model, "IfcWallStandardCase", "").area).toBeCloseTo(13.14, 6);
  });

  it("reads lengths in the unit of the model", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      const storey = ifc.storey("Niveau 1", 2.8);
      const pipe = ifc.element("IFCPIPESEGMENT", { name: "Tube", objectType: "Tube acier", placement: ifc.placement([1, 1, 3]), shape: ifc.shape([ifc.extrusion(ifc.circle(0.05), 2.5)]) });
      const beam = ifc.element("IFCBEAM", { name: "Poutre", objectType: "IPE 200", placement: ifc.placement([0, 0, 5], { axis: [1, 0, 0], ref: [0, 1, 0] }), shape: ifc.shape([ifc.extrusion(ifc.rectangle(0.1, 0.2), 6)]) });
      ifc.quantities("Qto_BeamBaseQuantities", [beam], { length: { Length: 6 }, volume: { GrossVolume: 0.12 } });
      ifc.contain(storey, [pipe, beam]);
    }, { lengthPrefix: "$" }));

    expect(model.storeys).toEqual([{ name: "Niveau 1", elevation: 2.8 }]);
    expect(row(model, "IfcPipeSegment", "Tube acier")).toMatchObject({ section: [100], lengths: 1 });
    expect(row(model, "IfcPipeSegment", "Tube acier").length).toBeCloseTo(2.5, 6);
    expect(row(model, "IfcBeam", "IPE 200")).toMatchObject({ stated: 1, volumes: 1, areas: 0 });
    expect(row(model, "IfcBeam", "IPE 200").volume).toBeCloseTo(0.12, 6);
  });

  it("reads the section of a short rectangular duct with the length the file declares for it", async () => {
    // Drawn the way Revit does, by its plan: 250 mm of a duct of 400 × 350 mm, without ports. Its longest side is not its run.
    const model = await readIfc(ifcFile((ifc) => {
      const duct = ifc.element("IFCDUCTSEGMENT", { name: "Gaine", objectType: "Gaine", placement: ifc.placement([0, 0, 0]), shape: ifc.shape([ifc.extrusion(ifc.rectangle(250, 400), 350)]) });
      ifc.quantities("Qto_DuctSegmentBaseQuantities", [duct], { length: { Length: 250 } });
    }));

    expect(row(model, "IfcDuctSegment", "Gaine")).toMatchObject({ section: [400, 350], lengths: 1, stated: 1 });
    expect(row(model, "IfcDuctSegment", "Gaine").length).toBeCloseTo(0.25, 6);
  });

  it("takes the depth of its extrusion as the run of a beam or of a column, shorter than its section or not", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      ifc.element("IFCBEAM", { name: "Chevêtre", objectType: "Chevêtre", placement: ifc.placement([0, 0, 2500], { axis: [1, 0, 0], ref: [0, 1, 0] }), shape: ifc.shape([ifc.extrusion(ifc.rectangle(300, 600), 200)]) });
      ifc.element("IFCCOLUMN", { name: "Poteau", objectType: "Poteau", placement: ifc.placement([3000, 0, 0]), shape: ifc.shape([ifc.extrusion(ifc.rectangle(400, 250), 2500)]) });
    }));

    expect(row(model, "IfcBeam", "Chevêtre")).toMatchObject({ section: [600, 300], lengths: 1, approximate: 0 });
    expect(row(model, "IfcBeam", "Chevêtre").length).toBeCloseTo(0.2, 6);
    expect(row(model, "IfcColumn", "Poteau")).toMatchObject({ section: [400, 250], lengths: 1, approximate: 0 });
    expect(row(model, "IfcColumn", "Poteau").length).toBeCloseTo(2.5, 6);
  });

  it("trusts the depth of a segment of another profile only when its ports are apart by it", async () => {
    // An oval duct: nothing says whether its profile is its section or its plan.
    const model = await readIfc(ifcFile((ifc) => {
      const oval = () => ifc.shape([ifc.extrusion(ifc.add("IFCELLIPSEPROFILEDEF(.AREA.,$,$,200.,100.)"), 1500)]);
      const placement = ifc.placement([0, 0, 0], { axis: [1, 0, 0], ref: [0, 1, 0] });
      const told = ifc.element("IFCDUCTSEGMENT", { name: "G1", objectType: "Ovale raccordée", placement, shape: oval() });
      ifc.ports(told, placement, [[0, 0, 0], [0, 0, 1500]]);
      ifc.element("IFCDUCTSEGMENT", { name: "G2", objectType: "Ovale seule", placement: ifc.placement([0, 2000, 0], { axis: [1, 0, 0], ref: [0, 1, 0] }), shape: oval() });
      ifc.element("IFCBEAM", { name: "P", objectType: "Poutre ovale", placement: ifc.placement([0, 4000, 0], { axis: [1, 0, 0], ref: [0, 1, 0] }), shape: oval() });
    }));

    expect(row(model, "IfcDuctSegment", "Ovale raccordée")).toMatchObject({ lengths: 1, approximate: 0, section: null });
    expect(row(model, "IfcDuctSegment", "Ovale raccordée").length).toBeCloseTo(1.5, 6);
    // Without ports the run is measured on the shape, and said approximate.
    expect(row(model, "IfcDuctSegment", "Ovale seule")).toMatchObject({ lengths: 1, approximate: 1 });
    expect(row(model, "IfcDuctSegment", "Ovale seule").length).toBeCloseTo(1.5, 2);
    expect(row(model, "IfcBeam", "Poutre ovale")).toMatchObject({ lengths: 1, approximate: 0 });
    expect(row(model, "IfcBeam", "Poutre ovale").length).toBeCloseTo(1.5, 6);
  });

  it("reads the run and the section of a segment whose shape is a copy of another, unless the copy is scaled", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      const origin = ifc.add(`IFCAXIS2PLACEMENT3D(${ifc.point(0, 0, 0)},$,$)`);
      const copied = (scale: string) => {
        const source = ifc.add(`IFCREPRESENTATIONMAP(${origin},${ifc.add(`IFCSHAPEREPRESENTATION(${ifc.context},'Body','SweptSolid',(${ifc.extrusion(ifc.circle(25), 800)}))`)})`);
        const operator = ifc.add(`IFCCARTESIANTRANSFORMATIONOPERATOR3D($,$,${ifc.point(0, 0, 0)},${scale},$)`);
        return ifc.shape([ifc.add(`IFCMAPPEDITEM(${source},${operator})`)], "MappedRepresentation");
      };
      ifc.element("IFCPIPESEGMENT", { name: "T1", objectType: "Copie", placement: ifc.placement([0, 0, 0]), shape: copied("$") });
      ifc.element("IFCPIPESEGMENT", { name: "T2", objectType: "Copie agrandie", placement: ifc.placement([1000, 0, 0]), shape: copied("2.") });
    }));

    expect(row(model, "IfcPipeSegment", "Copie")).toMatchObject({ section: [50], lengths: 1, approximate: 0 });
    expect(row(model, "IfcPipeSegment", "Copie").length).toBeCloseTo(0.8, 6);
    // Twice as large, the copy is not what its numbers say: it is measured as it is drawn.
    expect(row(model, "IfcPipeSegment", "Copie agrandie")).toMatchObject({ section: null, lengths: 1, approximate: 1 });
    expect(row(model, "IfcPipeSegment", "Copie agrandie").length).toBeCloseTo(1.6, 2);
  });

  it("reads lengths in feet, a unit the file defines by what it is in metres", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      const storey = ifc.storey("Level 1", 10);
      ifc.contain(storey, [ifc.element("IFCPIPESEGMENT", { name: "Pipe", objectType: "Pipe", placement: ifc.placement([0, 0, 10], { axis: [1, 0, 0], ref: [0, 1, 0] }), shape: ifc.shape([ifc.extrusion(ifc.circle(0.25), 10)]) })]);
    }, {
      lengthUnit: (add) => {
        const metre = add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
        const foot = add(`IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(0.3048),${metre})`);
        return add(`IFCCONVERSIONBASEDUNIT(${add("IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0)")},.LENGTHUNIT.,'FOOT',${foot})`);
      },
    }));

    expect(model.storeys).toEqual([{ name: "Level 1", elevation: 3.048 }]);
    expect(row(model, "IfcPipeSegment", "Pipe")).toMatchObject({ section: [152.4], lengths: 1 });
    expect(row(model, "IfcPipeSegment", "Pipe").length).toBeCloseTo(3.048, 6);
    expect(model.mesh!.max[0] - model.mesh!.min[0]).toBeCloseTo(3.048, 3);
  });

  it("does not read an area nor a volume whose unit the model does not declare", async () => {
    const wall = row(await readIfc(boilerRoomIfc({ areaUnits: false })), "IfcWall", "");

    // In a model in millimetres, 13,5 could be m² as well as mm²: nothing says which.
    expect(wall).toMatchObject({ lengths: 1, stated: 1, areas: 0, volumes: 0 });
    expect(wall.length).toBeCloseTo(5, 6);
  });

  it("puts on no storey what holds itself", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      ifc.storey("Étage", 0);
      const a = ifc.element("IFCSTAIR", { name: "A", objectType: "A", placement: ifc.placement([0, 0, 0]) });
      const b = ifc.element("IFCSTAIR", { name: "B", objectType: "B", placement: ifc.placement([0, 0, 0]) });
      ifc.add(`IFCRELAGGREGATES(${ifc.guid()},${ifc.owner},$,$,${a},(${b}))`);
      ifc.add(`IFCRELAGGREGATES(${ifc.guid()},${ifc.owner},$,$,${b},(${a}))`);
    }));

    expect(rowsOf(model, "IfcStair").map(({ type, storey }) => [type, storey])).toEqual([["A", null], ["B", null]]);
  });

  it("names a type only by what is a type: never by another line of the file", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      const valve = ifc.element("IFCVALVE", { name: "V", objectType: "Vanne", placement: ifc.placement([0, 0, 0]) });
      // The first line of the file is the company of its author, which has a name too.
      ifc.add(`IFCRELDEFINESBYTYPE(${ifc.guid()},${ifc.owner},$,$,(${valve}),#1)`);
    }));

    expect(model.rows.map(({ type }) => type)).toEqual(["Vanne"]);
    expect(JSON.stringify(model)).not.toContain("Secret");
  });

  it("names an element by its type, then by what it says it is, then by nothing", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      const shape = () => ifc.shape([ifc.extrusion(ifc.rectangle(100, 100), 100)]);
      const typed = ifc.element("IFCVALVE", { name: "V1", objectType: "Dit par l’objet", placement: ifc.placement([0, 0, 0]), shape: shape() });
      ifc.type("IFCVALVETYPE", "Vanne à sphère DN 50", [typed]);
      ifc.element("IFCVALVE", { name: "V2", objectType: "Vanne papillon", placement: ifc.placement([500, 0, 0]), shape: shape() });
      ifc.element("IFCVALVE", { name: "V3", placement: ifc.placement([1000, 0, 0]), shape: shape() });
    }));

    expect(rowsOf(model, "IfcValve").map(({ type, count, storey }) => [type, count, storey])).toEqual([["", 1, null], ["Vanne à sphère DN 50", 1, null], ["Vanne papillon", 1, null]]);
  });

  it("puts the parts of an assembly on the storey of the assembly", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      const storey = ifc.storey("Étage", 3000);
      const stair = ifc.element("IFCSTAIR", { name: "Escalier", placement: ifc.placement([0, 0, 3000]) });
      const flight = ifc.element("IFCSTAIRFLIGHT", { name: "Volée", placement: ifc.placement([0, 0, 3000]), shape: ifc.shape([ifc.extrusion(ifc.rectangle(1000, 3000), 200)]), more: ["$", "$", "$", "$", "$"] });
      ifc.add(`IFCRELAGGREGATES(${ifc.guid()},${ifc.owner},$,$,${stair},(${flight}))`);
      ifc.contain(storey, [stair]);
    }));

    expect(rowsOf(model, "IfcStairFlight").map(({ storey, count }) => [storey, count])).toEqual([["Étage", 1]]);
  });

  it("gives the shapes as one mesh in metres, the height upwards, in groups a class and a storey show or hide", async () => {
    const model = await readIfc(boilerRoomIfc());
    const mesh = model.mesh!;

    expect(mesh.truncated).toBe(false);
    expect(mesh.triangles).toBe(mesh.indices.length / 3);
    expect(mesh.positions.length % 3).toBe(0);
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.colors.length).toBe((mesh.positions.length / 3) * 4);
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.positions.length / 3);
    // The room is 5 m long; from the collector under the basement to the top of the wall: 3,28 m + 2,7 m.
    const size = mesh.max.map((value, axis) => value - mesh.min[axis]);
    expect(size[0]).toBeCloseTo(5, 2);
    expect(size[1]).toBeCloseTo(5.98, 2);

    // Every triangle is in one group, and the groups are told apart by class and storey.
    expect(mesh.groups.reduce((sum, group) => sum + group.count, 0)).toBe(mesh.indices.length);
    const named = mesh.groups.map((group) => `${model.classes[group.cls]}@${group.storey < 0 ? "-" : model.storeys[group.storey].name}`);
    expect(new Set(named).size).toBe(named.length);
    expect(named.sort()).toEqual([
      "IfcDuctSegment@Sous-sol", "IfcPipeFitting@Rez-de-chaussée", "IfcPipeSegment@-", "IfcPipeSegment@Rez-de-chaussée", "IfcPipeSegment@Sous-sol",
      "IfcSanitaryTerminal@Rez-de-chaussée", "IfcWall@Rez-de-chaussée",
    ]);
    const wall = mesh.groups.find((group) => model.classes[group.cls] === "IfcWall")!;
    // The wall is 2,7 m high, and is drawn with the opening cut in it.
    expect(wall.max[1] - wall.min[1]).toBeCloseTo(2.7, 3);
    expect(wall.count / 3).toBeGreaterThan(12);
  });

  it("keeps the positions exact for a model drawn far from its origin", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      ifc.element("IFCPIPESEGMENT", { name: "Tube", placement: ifc.placement([650_000_000, 6_860_000_000, 35_000], { axis: [1, 0, 0], ref: [0, 1, 0] }), shape: ifc.shape([ifc.extrusion(ifc.circle(50), 1234)]) });
    }));
    const mesh = model.mesh!;

    // 650 km from the origin, a float would round the millimetres away: the mesh is kept near its own origin.
    expect(mesh.max[0] - mesh.min[0]).toBeCloseTo(1.234, 4);
    expect(Math.max(...mesh.positions.map(Math.abs))).toBeLessThan(10);
  });

  it.each([["first", true], ["last", false]] as const)("draws around where most of the model is, and leaves out of the view a shape lost far from the rest, met %s", async (_, first) => {
    // A marker left at the origin of the survey, and five pipes 6 900 km from it, each half a metre after the other.
    const model = await readIfc(ifcFile((ifc) => {
      const marker = () => ifc.element("IFCBUILDINGELEMENTPROXY", { name: "Repère", objectType: "Repère", placement: ifc.placement([0, 0, 0]), shape: ifc.shape([ifc.extrusion(ifc.rectangle(100, 100), 100)]) });
      if (first) marker();
      for (let index = 0; index < 5; index += 1) {
        ifc.element("IFCPIPESEGMENT", { name: `Tube ${index}`, objectType: "Tube", placement: ifc.placement([650_000_000 + index * 500, 6_860_000_000, 35_000], { axis: [1, 0, 0], ref: [0, 1, 0] }), shape: ifc.shape([ifc.extrusion(ifc.circle(50), 1234)]) });
      }
      if (!first) marker();
    }));
    const mesh = model.mesh!;

    expect(model.truncated).toEqual({ elements: false, rows: false, geometry: false, apart: true });
    expect(mesh.groups.map((group) => model.classes[group.cls])).toEqual(["IfcPipeSegment"]);
    // The box of the mesh is that of the pipes, to the millimetre: 2 m of steps and a pipe of 1,234 m.
    expect(mesh.max[0] - mesh.min[0]).toBeCloseTo(3.234, 3);
    let reach = 0;
    for (const index of mesh.indices) reach = Math.max(reach, Math.abs(mesh.positions[index * 3]), Math.abs(mesh.positions[index * 3 + 1]), Math.abs(mesh.positions[index * 3 + 2]));
    expect(reach).toBeLessThan(10);
    // What is not drawn is still counted.
    expect(row(model, "IfcBuildingElementProxy", "Repère").count).toBe(1);
    expect(row(model, "IfcPipeSegment", "Tube").length).toBeCloseTo(5 * 1.234, 6);
  });

  it("keeps in the view a part of the model that stands away from the rest without being lost", async () => {
    // Nineteen pipes in a room, and a twentieth 300 m further: a manhole at the end of the plot.
    const model = await readIfc(ifcFile((ifc) => {
      for (let index = 0; index < 20; index += 1) {
        ifc.element("IFCPIPESEGMENT", { name: `Tube ${index}`, objectType: "Tube", placement: ifc.placement([index === 19 ? 300_000 : index * 200, 0, 0], { axis: [0, 1, 0], ref: [1, 0, 0] }), shape: ifc.shape([ifc.extrusion(ifc.circle(50), 1000)]) });
      }
    }));

    expect(model.truncated.apart).toBe(false);
    expect(model.mesh!.max[0] - model.mesh!.min[0]).toBeCloseTo(300.1, 2);
  });

  it("reads nothing of who wrote the model, nor where", async () => {
    const model = await readIfc(boilerRoomIfc());

    const said = JSON.stringify({ ...model, mesh: null });
    for (const secret of ["Secret", "Ada", "ada.secret", "chaufferie.ifc", "Users"]) expect(said).not.toContain(secret);
  });

  it("keeps a name on one line and cuts a long one", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      ifc.storey(`Niveau\n1 ${"x".repeat(400)}`, 0);
      ifc.element("IFCVALVE", { name: "V", objectType: `Vanne\r\n\tà\u2028boisseau ${"y".repeat(400)}`, placement: ifc.placement([0, 0, 0]) });
    }));

    expect(model.storeys[0].name).toMatch(/^Niveau 1 x+$/);
    expect(model.storeys[0].name.length).toBeLessThanOrEqual(200);
    expect(model.rows[0].type).toMatch(/^Vanne à boisseau y+$/);
    expect(model.rows[0].type.length).toBeLessThanOrEqual(200);
  });

  it("stops at its limits and says what was left out", async () => {
    const few = await readIfc(boilerRoomIfc(), { limits: { maxElements: 4 } });
    // The model says how many elements it holds, and how many of them are counted.
    expect(few.elements).toBe(12);
    expect(few.counted).toBe(4);
    expect(few.truncated.elements).toBe(true);
    expect(few.rows.reduce((sum, entry) => sum + entry.count, 0)).toBe(4);

    const light = await readIfc(boilerRoomIfc(), { limits: { maxTriangles: 100 } });
    expect(light.truncated).toEqual({ elements: false, rows: false, geometry: true, apart: false });
    expect(light.mesh!.truncated).toBe(true);
    expect(light.mesh!.triangles).toBeLessThanOrEqual(100);
    // What is not drawn is still counted and measured.
    expect(light.rows.reduce((sum, entry) => sum + entry.count, 0)).toBe(12);
    expect(row(light, "IfcPipeSegment", "Flexible:Raccordement").length).toBeCloseTo(1.2, 3);

    // The same for the corners of the shapes, counted apart from their triangles.
    const sparse = await readIfc(boilerRoomIfc(), { limits: { maxVertices: 100 } });
    expect(sparse.truncated.geometry).toBe(true);
    expect(sparse.mesh!.positions.length / 3).toBeLessThanOrEqual(100);
    expect(sparse.rows.reduce((sum, entry) => sum + entry.count, 0)).toBe(12);
  });

  it("gathers under their class the types past the number of lines it keeps", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      for (let index = 0; index < 6; index += 1) ifc.element("IFCVALVE", { name: `V${index}`, objectType: `Vanne ${index}`, placement: ifc.placement([index * 300, 0, 0]) });
    }), { limits: { maxRows: 3 } });

    expect(model.truncated.rows).toBe(true);
    expect(model.rows.map(({ type, count }) => [type, count])).toEqual([["", 3], ["Vanne 0", 1], ["Vanne 1", 1], ["Vanne 2", 1]]);
  });

  it("refuses what is not an IFC model", async () => {
    expect(await failure(new Uint8Array())).toEqual(new CadReadError("empty"));
    expect(await failure(encode("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"))).toEqual(new CadReadError("not_ifc"));
    // A STEP file of another trade: the same envelope, another schema.
    expect(await failure(encode("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('','',(''),(''),'','','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n"))).toEqual(new CadReadError("not_ifc"));
    expect(await failure(new Uint8Array(1024).fill(0x41))).toEqual(new CadReadError("not_ifc"));
  });

  it("says of a model in a version of the format it does not read that it is one, not that it is damaged", async () => {
    const old = new TextDecoder().decode(boilerRoomIfc()).replace("FILE_SCHEMA(('IFC4'))", "FILE_SCHEMA(('IFC2X2_FINAL'))");

    expect(await failure(encode(old))).toEqual(new CadReadError("unsupported_ifc"));
  });

  it("refuses a file larger than it reads", async () => {
    const error = await readIfc(boilerRoomIfc(), { limits: { maxBytes: 1000 } }).then(() => null, (cause: unknown) => cause);

    expect(error).toEqual(new CadReadError("too_large"));
  });

  it("reads a model without any element", async () => {
    const empty = await readIfc(ifcFile(() => undefined));

    expect(empty).toMatchObject({ schema: "IFC4", elements: 0, rows: [], classes: [], storeys: [], mesh: null });
  });

  it("says of a model cut before its end that it is damaged, not that it is something else", async () => {
    const whole = boilerRoomIfc();

    // Wherever the file stops: a model read by half would be counted by half, without a word.
    for (const kept of [0.999, 0.6, 0.25]) expect(await failure(whole.subarray(0, Math.floor(whole.length * kept)))).toEqual(new CadReadError("damaged_ifc"));
    // What follows the end of the file does not make it a cut one.
    const followed = new Uint8Array(whole.length + 3);
    followed.set(whole);
    followed.set([0x0d, 0x0a, 0x1a], whole.length);
    expect((await readIfc(followed)).elements).toBe(12);
  });

  it("ignores a quantity that is not a number a length can be, and a shape whose numbers are not", async () => {
    const model = await readIfc(ifcFile((ifc) => {
      const pipe = ifc.element("IFCPIPESEGMENT", { name: "Tube", objectType: "Tube", placement: ifc.placement([0, 0, 0]), shape: ifc.shape([ifc.extrusion(ifc.circle(50), 1000)]) });
      ifc.quantities("Qto_PipeSegmentBaseQuantities", [pipe], { length: { Length: -5 } });
      ifc.element("IFCPIPESEGMENT", { name: "Vide", objectType: "Sans forme", placement: ifc.placement([0, 0, 0]) });
    }));

    expect(row(model, "IfcPipeSegment", "Tube")).toMatchObject({ stated: 0, lengths: 1, section: [100] });
    expect(row(model, "IfcPipeSegment", "Tube").length).toBeCloseTo(1, 6);
    expect(row(model, "IfcPipeSegment", "Sans forme")).toMatchObject({ count: 1, lengths: 0, length: 0 });
  });

  it("writes a text of the file as the file holds it", () => {
    expect(ifcText("Évacuation d'eau")).toBe("'\\X2\\00C9\\X0\\vacuation d''eau'");
  });
});
