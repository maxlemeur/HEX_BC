// Fictional IFC models, written line by line the way an export writes them:
// the tests and the journeys read these, never a model of a real building.

/** A text as a STEP file holds it: quotes doubled, and what is not ASCII as « \X2\00E9\X0\ ». */
export function ifcText(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === "'") out += "''";
    else if (char === "\\") out += "\\\\";
    else if (code >= 0x20 && code < 0x7f) out += char;
    else out += `\\X2\\${code.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
  }
  return `'${out}'`;
}

const real = (value: number) => (Number.isInteger(value) ? `${value}.` : String(value));
const list = (values: readonly (number | string)[]) => `(${values.map((value) => (typeof value === "number" ? real(value) : value)).join(",")})`;

export type IfcSchemaName = "IFC4" | "IFC2X3";

export type IfcWriter = {
  schema: IfcSchemaName;
  /** Adds a line and gives its reference: « #12 ». */
  add(line: string): string;
  /** The reference every rooted line gives as its owner history. */
  owner: string;
  context: string;
  guid(): string;
  point(x: number, y: number, z: number): string;
  direction(x: number, y: number, z: number): string;
  /** A placement in the model; `axis` is where its Z points and `ref` its X. */
  placement(at: [number, number, number], options?: { axis?: [number, number, number]; ref?: [number, number, number]; relativeTo?: string }): string;
  circle(radius: number, wallThickness?: number): string;
  rectangle(x: number, y: number): string;
  /** The profile swept along the Z of the placement of its element. */
  extrusion(profile: string, depth: number): string;
  /** A closed box of faces, from the origin of its element. */
  box(x: number, y: number, z: number): string;
  /** The shape of an element, made of these items. */
  shape(items: string[], type?: string): string;
  storey(name: string, elevation: number): string;
  /** An element of that class: « IFCPIPESEGMENT ». `more` are the attributes its class adds after the tag. */
  element(cls: string, options: { name: string; objectType?: string; placement: string; shape?: string; more?: string[] }): string;
  contain(storey: string, elements: string[]): void;
  /** The ends an element connects by, placed from its own placement. */
  ports(element: string, placement: string, at: [number, number, number][]): void;
  /** A type of that class, « IFCPIPESEGMENTTYPE », given to these elements. */
  type(cls: string, name: string, elements: string[], predefined?: string): string;
  /** Base quantities of these elements: lengths in the unit of the model, areas in m², volumes in m³. */
  quantities(name: string, elements: string[], values: { length?: Record<string, number>; area?: Record<string, number>; volume?: Record<string, number> }): string;
};

export type IfcFileOptions = {
  schema?: IfcSchemaName;
  /** The length unit: « .MILLI. » (the default), or « $ » for metres. */
  lengthPrefix?: string;
  /** A length unit of one's own, written with `add`, in place of the SI one: its reference. */
  lengthUnit?(add: (line: string) => string): string;
  /** False for a model that declares neither its unit of area nor its unit of volume. */
  areaUnits?: boolean;
  application?: string;
};

/** The lines of a model as the bytes of its file. The header names an author, a company and a path of his machine: none may be read out. */
export function ifcFile(build: (writer: IfcWriter) => void, options: IfcFileOptions = {}): Uint8Array {
  const schema = options.schema ?? "IFC4";
  const lines: string[] = [];
  const add = (line: string) => {
    lines.push(`#${lines.length + 1}=${line};`);
    return `#${lines.length}`;
  };
  let guids = 0;
  const guid = () => `'${(guids += 1).toString(36).toUpperCase().padStart(22, "0")}'`;

  const organization = add(`IFCORGANIZATION($,${ifcText("Bureau Secret")},$,$,$)`);
  const person = add(`IFCPERSON($,${ifcText("Secret")},${ifcText("Ada")},$,$,$,$,$)`);
  const author = add(`IFCPERSONANDORGANIZATION(${person},${organization},$)`);
  const application = add(`IFCAPPLICATION(${organization},'1.0',${ifcText(options.application ?? "Atelier fictif")},'atelier')`);
  const owner = add(`IFCOWNERHISTORY(${author},${application},$,.ADDED.,$,$,$,1700000000)`);
  const origin = add("IFCCARTESIANPOINT((0.,0.,0.))");
  const origin2d = add("IFCCARTESIANPOINT((0.,0.))");
  const centred = add(`IFCAXIS2PLACEMENT2D(${origin2d},$)`);
  const up = add("IFCDIRECTION((0.,0.,1.))");
  const world = add(`IFCAXIS2PLACEMENT3D(${origin},$,$)`);
  const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,${world},$)`);
  const units = add(`IFCUNITASSIGNMENT((${[
    options.lengthUnit ? options.lengthUnit(add) : add(`IFCSIUNIT(*,.LENGTHUNIT.,${options.lengthPrefix ?? ".MILLI."},.METRE.)`),
    ...(options.areaUnits === false ? [] : [add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"), add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)")]),
  ].join(",")}))`);
  const project = add(`IFCPROJECT(${guid()},${owner},${ifcText("Projet Secret")},$,$,$,$,(${context}),${units})`);
  const worldPlacement = add(`IFCLOCALPLACEMENT($,${world})`);
  const site = add(`IFCSITE(${guid()},${owner},${ifcText("Terrain Secret")},$,$,${worldPlacement},$,$,.ELEMENT.,$,$,$,$,$)`);
  const building = add(`IFCBUILDING(${guid()},${owner},${ifcText("Immeuble Secret")},$,$,${worldPlacement},$,$,.ELEMENT.,$,$,$)`);
  add(`IFCRELAGGREGATES(${guid()},${owner},$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES(${guid()},${owner},$,$,${site},(${building}))`);
  const storeys: string[] = [];

  const point = (x: number, y: number, z: number) => add(`IFCCARTESIANPOINT(${list([x, y, z])})`);
  const direction = (x: number, y: number, z: number) => add(`IFCDIRECTION(${list([x, y, z])})`);
  const quantity = (kind: "LENGTH" | "AREA" | "VOLUME", name: string, value: number) =>
    add(`IFCQUANTITY${kind}(${ifcText(name)},$,$,${real(value)}${schema === "IFC4" ? ",$" : ""})`);

  const writer: IfcWriter = {
    schema,
    add,
    owner,
    context,
    guid,
    point,
    direction,
    placement(at, { axis, ref, relativeTo } = {}) {
      const position = add(`IFCAXIS2PLACEMENT3D(${point(...at)},${axis ? direction(...axis) : "$"},${ref ? direction(...ref) : "$"})`);
      return add(`IFCLOCALPLACEMENT(${relativeTo ?? "$"},${position})`);
    },
    circle: (radius, wallThickness) => (wallThickness === undefined
      ? add(`IFCCIRCLEPROFILEDEF(.AREA.,$,${centred},${real(radius)})`)
      : add(`IFCCIRCLEHOLLOWPROFILEDEF(.AREA.,$,${centred},${real(radius)},${real(wallThickness)})`)),
    rectangle: (x, y) => add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${centred},${real(x)},${real(y)})`),
    extrusion: (profile, depth) => add(`IFCEXTRUDEDAREASOLID(${profile},${world},${up},${real(depth)})`),
    box(x, y, z) {
      const corners = [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]].map(([a, b, c]) => point(a, b, c));
      const faces = [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].map((face) => {
        const loop = add(`IFCPOLYLOOP((${face.map((corner) => corners[corner]).join(",")}))`);
        return add(`IFCFACE((${add(`IFCFACEOUTERBOUND(${loop},.T.)`)}))`);
      });
      return add(`IFCFACETEDBREP(${add(`IFCCLOSEDSHELL((${faces.join(",")}))`)})`);
    },
    shape: (items, type = "SweptSolid") => add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${add(`IFCSHAPEREPRESENTATION(${context},'Body','${type}',(${items.join(",")}))`)}))`),
    storey(name, elevation) {
      const placement = writer.placement([0, 0, elevation]);
      const storey = add(`IFCBUILDINGSTOREY(${guid()},${owner},${ifcText(name)},$,$,${placement},$,$,.ELEMENT.,${real(elevation)})`);
      storeys.push(storey);
      return storey;
    },
    element: (cls, { name, objectType, placement, shape, more = ["$"] }) =>
      add(`${cls}(${guid()},${owner},${ifcText(name)},$,${objectType === undefined ? "$" : ifcText(objectType)},${placement},${shape ?? "$"},$${more.map((value) => `,${value}`).join("")})`),
    contain(storey, elements) {
      add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid()},${owner},$,$,(${elements.join(",")}),${storey})`);
    },
    ports(element, placement, at) {
      const ports = at.map((location, index) =>
        add(`IFCDISTRIBUTIONPORT(${guid()},${owner},'Port ${index + 1}',$,$,${writer.placement(location, { relativeTo: placement })},$,.SOURCEANDSINK.${schema === "IFC4" ? ",$,$" : ""})`));
      // IFC4 nests the ports in their element; IFC2X3 connects each of them to it.
      if (schema === "IFC4") add(`IFCRELNESTS(${guid()},${owner},$,$,${element},(${ports.join(",")}))`);
      else for (const port of ports) add(`IFCRELCONNECTSPORTTOELEMENT(${guid()},${owner},$,$,${port},${element})`);
    },
    type(cls, name, elements, predefined = ".NOTDEFINED.") {
      const type = add(`${cls}(${guid()},${owner},${ifcText(name)},$,$,$,$,$,$,${predefined})`);
      add(`IFCRELDEFINESBYTYPE(${guid()},${owner},$,$,(${elements.join(",")}),${type})`);
      return type;
    },
    quantities(name, elements, values) {
      const members = [
        ...Object.entries(values.length ?? {}).map(([key, value]) => quantity("LENGTH", key, value)),
        ...Object.entries(values.area ?? {}).map(([key, value]) => quantity("AREA", key, value)),
        ...Object.entries(values.volume ?? {}).map(([key, value]) => quantity("VOLUME", key, value)),
      ];
      const set = add(`IFCELEMENTQUANTITY(${guid()},${owner},${ifcText(name)},$,$,(${members.join(",")}))`);
      add(`IFCRELDEFINESBYPROPERTIES(${guid()},${owner},$,$,(${elements.join(",")}),${set})`);
      return set;
    },
  };

  build(writer);
  if (storeys.length > 0) add(`IFCRELAGGREGATES(${guid()},${owner},$,$,${building},(${storeys.join(",")}))`);

  const text = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    `FILE_NAME(${ifcText("C:\\Users\\ada.secret\\Projets\\chaufferie.ifc")},'2026-11-10T10:00:00',(${ifcText("Ada Secret")}),(${ifcText("Bureau Secret")}),'Atelier fictif','Atelier fictif','');`,
    `FILE_SCHEMA(('${schema}'));`,
    "ENDSEC;",
    "DATA;",
    ...lines,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
  return new TextEncoder().encode(text);
}

/**
 * A boiler room on two storeys, in millimetres. On the ground floor: a wall with its base quantities
 * and an opening, three PVC pipes of 110 mm (4,25 m, 1,75 m and a stub of 60 mm, shorter than it is wide),
 * two elbows and a washbasin. In the basement: a copper pipe of 40 mm (2 m), a duct of 400 × 350 mm
 * drawn the way Revit does (its run in the profile, 3 m), and a hose drawn by its faces (1,2 m).
 * and a stub of the same duct, 250 mm between its two ports, shorter than the duct is wide.
 * Outside any storey: a collector whose length the file declares (3,1 m, drawn 3 m).
 */
export function boilerRoomIfc(options: IfcFileOptions = {}): Uint8Array {
  return ifcFile((ifc) => {
    const four = ifc.schema === "IFC4";
    const pipeClass = four ? "IFCPIPESEGMENT" : "IFCFLOWSEGMENT", ductClass = four ? "IFCDUCTSEGMENT" : "IFCFLOWSEGMENT";
    const fittingClass = four ? "IFCPIPEFITTING" : "IFCFLOWFITTING", terminalClass = four ? "IFCSANITARYTERMINAL" : "IFCFLOWTERMINAL";
    const more = four ? ["$"] : [];
    const alongX: { axis?: [number, number, number]; ref?: [number, number, number] } = { axis: [1, 0, 0], ref: [0, 1, 0] }, upright: typeof alongX = {};
    const ground = ifc.storey("Rez-de-chaussée", 0), basement = ifc.storey("Sous-sol", -3000);

    const wall = ifc.element(four ? "IFCWALL" : "IFCWALLSTANDARDCASE", { name: "Mur de refend", placement: ifc.placement([2500, 0, 0]), shape: ifc.shape([ifc.extrusion(ifc.rectangle(5000, 200), 2700)]), more });
    ifc.quantities("Qto_WallBaseQuantities", [wall], { length: { Length: 5000, Height: 2700 }, area: { GrossSideArea: 13.5, NetSideArea: 13.14 }, volume: { NetVolume: 2.628 } });
    const opening = ifc.element("IFCOPENINGELEMENT", { name: "Trémie", placement: ifc.placement([1000, 0, 300]), shape: ifc.shape([ifc.extrusion(ifc.rectangle(600, 600), 600)]), more });
    ifc.add(`IFCRELVOIDSELEMENT(${ifc.guid()},${ifc.owner},$,$,${wall},${opening})`);
    ifc.element("IFCSPACE", { name: "Chaufferie", placement: ifc.placement([2500, 2000, 0]), shape: ifc.shape([ifc.extrusion(ifc.rectangle(5000, 4000), 2500)]), more: [".ELEMENT.", ".INTERNAL.", "$"] });

    const pvc = (name: string, at: [number, number, number], depth: number, placed = alongX) =>
      ifc.element(pipeClass, { name, objectType: "Tuyau PVC:Évacuation", placement: ifc.placement(at, placed), shape: ifc.shape([ifc.extrusion(ifc.circle(55, 3.2), depth)]), more });
    const drains = [pvc("Tuyau PVC:Évacuation:1001", [300, 600, 300], 4250), pvc("Tuyau PVC:Évacuation:1002", [4610, 600, 300], 1750, upright), pvc("Tuyau PVC:Évacuation:1003", [240, 600, 300], 60)];
    ifc.type("IFCPIPESEGMENTTYPE", "Tuyau PVC:Évacuation", drains, ".RIGIDSEGMENT.");
    const elbow = (name: string, at: [number, number, number]) =>
      ifc.element(fittingClass, { name, objectType: "Coude PVC:87°", placement: ifc.placement(at), shape: ifc.shape([ifc.extrusion(ifc.rectangle(130, 130), 130)]), more });
    const elbows = [elbow("Coude PVC:87°:2001", [4610, 600, 235]), elbow("Coude PVC:87°:2002", [4610, 600, 2050])];
    const basin = ifc.element(terminalClass, { name: "Lavabo:Standard:3001", objectType: "Lavabo:Standard", placement: ifc.placement([2000, 400, 800]), shape: ifc.shape([ifc.extrusion(ifc.rectangle(600, 450), 200)]), more });
    ifc.contain(ground, [wall, ...drains, ...elbows, basin]);

    const copper = ifc.element(pipeClass, { name: "Tuyau cuivre:Alimentation:1101", objectType: "Tuyau cuivre:Alimentation", placement: ifc.placement([500, 800, -2600], alongX), shape: ifc.shape([ifc.extrusion(ifc.circle(20), 2000)]), more });
    const duct = ifc.element(ductClass, { name: "Gaine rectangulaire:Soufflage:1201", objectType: "Gaine rectangulaire:Soufflage", placement: ifc.placement([2500, 2500, -700]), shape: ifc.shape([ifc.extrusion(ifc.rectangle(3000, 400), 350)]), more });
    const stubPlacement = ifc.placement([4200, 2500, -700]);
    const stub = ifc.element(ductClass, { name: "Gaine rectangulaire:Soufflage:1202", objectType: "Gaine rectangulaire:Soufflage", placement: stubPlacement, shape: ifc.shape([ifc.extrusion(ifc.rectangle(250, 400), 350)]), more });
    ifc.ports(stub, stubPlacement, [[-125, 0, 175], [125, 0, 175]]);
    const hose = ifc.element(pipeClass, { name: "Flexible:Raccordement:1301", objectType: "Flexible:Raccordement", placement: ifc.placement([800, 1500, -2000], { axis: [0, 0, 1], ref: [0.6, 0.8, 0] }), shape: ifc.shape([ifc.box(1200, 50, 50)], "Brep"), more });
    ifc.contain(basement, [copper, duct, stub, hose]);

    const collector = ifc.element(pipeClass, { name: "Collecteur:Fonte:1401", objectType: "Collecteur:Fonte", placement: ifc.placement([0, 3000, -3200], alongX), shape: ifc.shape([ifc.extrusion(ifc.circle(80), 3000)]), more });
    ifc.quantities(four ? "Qto_PipeSegmentBaseQuantities" : "BaseQuantities", [collector], { length: { Length: 3100 } });
  }, options);
}

/** The reading of `boilerRoomIfc`, whatever its schema: what a test or a journey expects of it. */
export const BOILER_ROOM_IFC = { elements: 12, storeys: ["Sous-sol", "Rez-de-chaussée"] } as const;
