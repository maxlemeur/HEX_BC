// SPDX-License-Identifier: GPL-3.0-or-later
//
// The two programs that load LibreDWG (GPL-3.0-or-later), here in its
// WebAssembly build @mlightcad/libredwg-web, a package published under the
// GPL-3.0 whose own reading module the second program runs too. The
// application does not link them: the server (dwg-conversion-server.ts) hands one of these texts to a Node
// process of its own, which gets a DWG on its standard input and writes a DXF
// on its standard output. Nothing else is exchanged, and the process is
// started without the right to read or write the disk (LibreDWG's own files
// apart), to open a connection or to start a program. This file, and only
// this file, is offered under the GNU General Public License, version 3 or
// later, whose text is in LICENSES/GPL-3.0-or-later.txt.
//
// A program is told, as its one argument, the JSON of `moduleUrl` (file: URL
// of the module that creates the WebAssembly instance), `readerUrl` (file: URL
// of the module that reads a drawing into objects) and `wasmDirectory`
// (directory of the .wasm file, with the closing separator). It exits with 0
// once the whole DXF is written out, with 3 when LibreDWG did not read the
// drawing (its error code is 128 or more, or what it read has no model space),
// with 2 when anything else broke: what was written before a 2 or a 3 is not
// a drawing.

/** For a DWG of the 2004 format or a later one: LibreDWG writes the DXF itself. */
export const DWG_CONVERSION_SCRIPT = `
const { writeSync } = require("node:fs");
const input = JSON.parse(process.argv[1]);
(async () => {
  let chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const quiet = () => {};
  const createModule = (await import(input.moduleUrl)).default;
  const libredwg = await createModule({ locateFile: (name) => input.wasmDirectory + name, print: quiet, printErr: quiet });
  const { FS } = libredwg;
  // The DWG lives in the memory of the WebAssembly instance, never on the disk.
  FS.writeFile("/in.dwg", Buffer.concat(chunks));
  chunks = null;
  // The DXF is a device that writes to the standard output: it leaves as LibreDWG writes it and
  // nothing of it is kept here, so a drawing that grows past what the server takes is stopped on its way.
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const device = FS.makedev(64, 0);
  FS.registerDevice(device, {
    write(stream, buffer, offset, length) {
      for (let at = 0; at < length;) {
        try {
          at += writeSync(1, buffer, offset + at, length - at);
        } catch (error) {
          if (error.code !== "EAGAIN") throw error;
          Atomics.wait(pause, 0, 0, 2);
        }
      }
      return length;
    },
  });
  FS.mkdev("/out.dxf", 0o666, device);
  const code = libredwg.dwg_write_dxf("/in.dwg", "/out.dxf");
  process.exit(code >= 128 ? 3 : 0);
})().catch(() => process.exit(2));
`;

/**
 * `writeDatabaseDxf(database, version, unread, write)`: the DXF of a drawing as LibreDWG's reading hands it over
 * (`database`: its layers, its blocks and their entities, as objects), written for the reader of src/lib/cad and
 * holding what that reader takes, nothing more. `version` is the format code of the DWG, `unread` counts by type
 * the entities the reading left out, and `write` is given the DXF part by part. Everything in `database` comes
 * from a file someone outside sent: a value that is not what it should be is written as nothing, a zero or an
 * empty text, and no text reaches the DXF with a line break in it. Returns false, with nothing written, for a
 * database without a model space: that is what LibreDWG hands over for a file that is not a drawing.
 */
export const DWG_DATABASE_DXF_WRITER = String.raw`
function writeDatabaseDxf(database, version, unread, write) {
  let held = [];
  const flush = () => {
    if (held.length > 0) write(held.join(""));
    held = [];
  };
  const put = (code, value) => {
    held.push(code + "\n" + value + "\n");
    if (held.length >= 4096) flush();
  };
  const real = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const whole = (value) => Math.trunc(real(value));
  const line = (value) => (typeof value === "string" ? value.replace(/[\r\n]+/g, " ") : "");
  const degrees = (value) => (real(value) * 180) / Math.PI;
  const list = (value) => (Array.isArray(value) ? value : []);
  const record = (value) => (value !== null && typeof value === "object" ? value : {});
  const point = (code, value, deep) => {
    const { x, y, z } = record(value);
    put(code, real(x));
    put(code + 10, real(y));
    if (deep) put(code + 20, real(z));
  };
  // The direction a flat entity is seen from; LibreDWG leaves it at zero where the file does not hold one.
  const extrusion = (value) => {
    const x = real(record(value).x), y = real(record(value).y), z = real(record(value).z);
    if (x === 0 && y === 0 && z >= 0) return;
    put(210, x);
    put(220, y);
    put(230, z);
  };
  // A type is written under the name the DXF gives it. One that would read as the structure of the file, or as a
  // record that belongs to the entity before it, is not written at all.
  const STRUCTURE = ["SECTION", "ENDSEC", "TABLE", "ENDTAB", "BLOCK", "ENDBLK", "EOF", "CLASS", "VERTEX", "SEQEND", "ATTRIB"];
  const named = (type) => {
    const name = type === "SECTION" ? "SECTIONOBJECT" : type;
    return /^[A-Z0-9_]{1,64}$/.test(name) && !STRUCTURE.includes(name) ? name : "";
  };
  const head = (type, entity, paper) => {
    put(0, type);
    put(8, line(entity.layer).trim() || "0");
    if (Number.isInteger(entity.colorIndex) && entity.colorIndex >= 0 && entity.colorIndex <= 255) put(62, entity.colorIndex);
    if (typeof entity.color === "number") put(420, entity.color & 0xffffff);
    if (paper) put(67, 1);
    if (entity.isVisible === false) put(60, 1);
  };
  // TEXT, ATTRIB and ATTDEF write one line the same way; the vertical alignment has its own code in the first.
  const label = (type, entity, text, paper, verticalCode, between) => {
    const horizontal = whole(text.halign), vertical = whole(text.valign);
    head(type, entity, paper);
    point(10, text.startPoint, false);
    put(40, real(text.textHeight));
    put(1, line(text.text));
    put(50, degrees(text.rotation));
    put(41, real(text.xScale) > 0 ? real(text.xScale) : 1);
    put(72, horizontal);
    if (horizontal !== 0 || vertical !== 0) point(11, text.endPoint, false);
    extrusion(text.extrusionDirection);
    between();
    put(verticalCode, vertical);
  };
  const vertices = (entity, layer, each) => {
    for (const vertex of list(entity.vertices)) {
      put(0, "VERTEX");
      put(8, layer);
      each(record(vertex));
    }
    put(0, "SEQEND");
    put(8, layer);
  };
  const fourCorners = (entity, deep) => {
    point(10, entity.corner1, deep);
    point(11, entity.corner2, deep);
    point(12, entity.corner3, deep);
    point(13, entity.corner4, deep);
  };
  const hatchEdge = (edge) => {
    const type = whole(edge.type);
    put(72, type);
    if (type === 1) {
      point(10, edge.start, false);
      point(11, edge.end, false);
    } else if (type === 2) {
      point(10, edge.center, false);
      put(40, real(edge.radius));
      put(50, degrees(edge.startAngle));
      put(51, degrees(edge.endAngle));
      put(73, edge.isCCW ? 1 : 0);
    } else if (type === 3) {
      point(10, edge.center, false);
      point(11, edge.end, false);
      put(40, real(edge.lengthOfMinorAxis));
      put(50, degrees(edge.startAngle));
      put(51, degrees(edge.endAngle));
      put(73, edge.isCCW ? 1 : 0);
    } else if (type === 4) {
      const knots = list(edge.knots), control = list(edge.controlPoints), fit = list(edge.fitDatum);
      put(94, whole(edge.degree));
      put(73, edge.isRational ? 1 : 0);
      put(74, edge.isPeriodic ? 1 : 0);
      put(95, knots.length);
      put(96, control.length);
      for (const knot of knots) put(40, real(knot));
      for (const at of control) {
        point(10, at, false);
        if (edge.isRational) put(42, real(record(at).weight));
      }
      if (fit.length > 0) {
        put(97, fit.length);
        for (const at of fit) point(11, at, false);
      }
    }
  };
  const draw = (value, paper) => {
    const entity = record(value), type = line(entity.type).trim().toUpperCase();
    const layer = line(entity.layer).trim() || "0";
    switch (type) {
      // They belong to the entity before them, which writes them.
      case "": case "ATTRIB": case "VERTEX": case "SEQEND": return;
      case "LINE":
        head(type, entity, paper);
        point(10, entity.startPoint, true);
        point(11, entity.endPoint, true);
        return;
      case "LWPOLYLINE": {
        const corners = list(entity.vertices);
        head(type, entity, paper);
        put(90, corners.length);
        // LibreDWG keeps the flags of the DWG record, where 512 says closed.
        put(70, (whole(entity.flag) & 512) !== 0 ? 1 : 0);
        for (const corner of corners) {
          point(10, corner, false);
          if (real(record(corner).bulge) !== 0) put(42, real(corner.bulge));
        }
        extrusion(entity.extrusionDirection);
        return;
      }
      case "POLYLINE2D":
        head("POLYLINE", entity, paper);
        put(66, 1);
        put(70, whole(entity.flag) & ~(8 | 16 | 64));
        extrusion(entity.extrusionDirection);
        vertices(entity, layer, (vertex) => {
          point(10, vertex, false);
          if (real(vertex.bulge) !== 0) put(42, real(vertex.bulge));
          put(70, whole(vertex.flag));
        });
        return;
      case "POLYLINE3D":
        head("POLYLINE", entity, paper);
        put(66, 1);
        put(70, (whole(entity.flag) & 1) | 8);
        vertices(entity, layer, (vertex) => {
          point(10, vertex, true);
          put(70, whole(vertex.flag) | 32);
        });
        return;
      case "ARC": case "CIRCLE":
        head(type, entity, paper);
        point(10, entity.center, true);
        put(40, real(entity.radius));
        if (type === "ARC") {
          put(50, degrees(entity.startAngle));
          put(51, degrees(entity.endAngle));
        }
        extrusion(entity.extrusionDirection);
        return;
      case "ELLIPSE": {
        const normal = record(entity.extrusionDirection);
        head(type, entity, paper);
        point(10, entity.center, true);
        point(11, entity.majorAxisEndPoint, true);
        if (real(normal.x) !== 0 || real(normal.y) !== 0 || real(normal.z) !== 0) point(210, normal, true);
        put(40, real(entity.axisRatio));
        put(41, real(entity.startAngle));
        put(42, real(entity.endAngle));
        return;
      }
      case "SPLINE": {
        const knots = list(entity.knots), control = list(entity.controlPoints), fit = list(entity.fitPoints), weights = list(entity.weights);
        head(type, entity, paper);
        put(70, whole(entity.flag));
        put(71, whole(entity.degree));
        put(72, knots.length);
        put(73, control.length);
        put(74, fit.length);
        for (const knot of knots) put(40, real(knot));
        if (weights.length === control.length) for (const weight of weights) put(41, real(weight));
        for (const at of control) point(10, at, true);
        for (const at of fit) point(11, at, true);
        return;
      }
      case "INSERT": {
        const attributes = list(entity.attribs);
        head(type, entity, paper);
        if (attributes.length > 0) put(66, 1);
        put(2, line(entity.name));
        point(10, entity.insertionPoint, true);
        put(41, real(entity.xScale));
        put(42, real(entity.yScale));
        put(43, real(entity.zScale));
        put(50, degrees(entity.rotation));
        put(70, Math.max(1, whole(entity.columnCount)));
        put(71, Math.max(1, whole(entity.rowCount)));
        put(44, real(entity.columnSpacing));
        put(45, real(entity.rowSpacing));
        extrusion(entity.extrusionDirection);
        if (attributes.length === 0) return;
        for (const value of attributes) {
          const attribute = record(value);
          label("ATTRIB", attribute, record(attribute.text), paper, 74, () => {
            put(2, line(attribute.tag));
            put(70, whole(attribute.flags));
          });
        }
        put(0, "SEQEND");
        put(8, layer);
        return;
      }
      case "TEXT":
        label(type, entity, entity, paper, 73, () => {});
        return;
      case "ATTDEF":
        label(type, entity, record(entity.text), paper, 74, () => {
          put(3, line(entity.prompt));
          put(2, line(entity.tag));
          put(70, whole(entity.flags));
        });
        return;
      case "MTEXT": {
        // A paragraph breaks its lines with its own code, and is written 250 characters at a time.
        const text = typeof entity.text === "string" ? entity.text.replace(/\r?\n|\r/g, "\\P") : "";
        const direction = record(entity.direction);
        head(type, entity, paper);
        point(10, entity.insertionPoint, true);
        put(40, real(entity.textHeight));
        put(41, real(entity.rectWidth));
        put(71, whole(entity.attachmentPoint));
        let at = 0;
        while (text.length - at > 250) {
          // A character written on two code units is not cut in two.
          const high = text.charCodeAt(at + 249), end = at + (high >= 0xd800 && high <= 0xdbff ? 249 : 250);
          put(3, text.slice(at, end));
          at = end;
        }
        put(1, text.slice(at));
        if (real(direction.x) !== 0 || real(direction.y) !== 0) point(11, direction, true);
        else put(50, degrees(entity.rotation));
        return;
      }
      case "DIMENSION":
        head(type, entity, paper);
        put(2, line(entity.name));
        return;
      case "HATCH": {
        const loops = list(entity.boundaryPaths);
        head(type, entity, paper);
        point(10, null, true);
        extrusion(entity.extrusionDirection);
        put(2, line(entity.patternName));
        put(70, whole(entity.solidFill) === 1 ? 1 : 0);
        put(91, loops.length);
        for (const value of loops) {
          const loop = record(value), flag = whole(loop.boundaryPathTypeFlag);
          put(92, flag);
          if ((flag & 2) !== 0) {
            const corners = list(loop.vertices);
            put(72, loop.hasBulge ? 1 : 0);
            put(73, loop.isClosed ? 1 : 0);
            put(93, corners.length);
            for (const corner of corners) {
              point(10, corner, false);
              if (real(record(corner).bulge) !== 0) put(42, real(corner.bulge));
            }
          } else {
            const edges = list(loop.edges);
            put(93, edges.length);
            for (const edge of edges) hatchEdge(record(edge));
          }
          put(97, 0);
        }
        put(75, whole(entity.hatchStyle));
        put(76, whole(entity.patternType));
        put(98, 0);
        return;
      }
      case "SOLID": case "TRACE":
        head(type, entity, paper);
        fourCorners(entity, false);
        extrusion(entity.extrusionDirection);
        return;
      case "3DFACE":
        head(type, entity, paper);
        fourCorners(entity, true);
        return;
      case "LEADER": {
        const corners = list(entity.vertices);
        head(type, entity, paper);
        put(76, corners.length);
        for (const corner of corners) point(10, corner, true);
        return;
      }
      // What the reader of the DXF does not draw is named, so that it is counted as left out.
      default:
        if (named(type) !== "") head(named(type), entity, paper);
    }
  };
  const tables = record(record(database).tables);
  const space = (pattern) => list(record(tables.BLOCK_RECORD).entries).map(record).filter((block) => pattern.test(line(block.name).trim()));
  if (space(/^[*$]model_space$/i).length === 0) return false;

  put(0, "SECTION");
  put(2, "HEADER");
  put(9, "$ACADVER");
  put(1, version);
  put(9, "$INSUNITS");
  put(70, whole(record(record(database).header).INSUNITS));
  put(0, "ENDSEC");

  // A layer without a name would be read as layer 0 and pass its state on to the real one.
  const layers = list(record(tables.LAYER).entries).map(record).filter((layer) => typeof layer.name === "string" && layer.name.trim() !== "");
  put(0, "SECTION");
  put(2, "TABLES");
  put(0, "TABLE");
  put(2, "LAYER");
  put(70, layers.length);
  for (const layer of layers) {
    const index = Number.isInteger(layer.colorIndex) && layer.colorIndex >= 1 && layer.colorIndex <= 255 ? layer.colorIndex : 0;
    put(0, "LAYER");
    put(2, line(layer.name));
    put(70, (layer.frozen ? 1 : 0) | (layer.locked ? 4 : 0));
    put(62, (index || 7) * (layer.off ? -1 : 1));
    // Without an index the colour is one of its own.
    if (index === 0 && typeof layer.color === "number") put(420, layer.color & 0xffffff);
    // Before the 2000 format a layer cannot be kept off the plot: LibreDWG then reads a flag that is not there.
    if (version >= "AC1015") put(290, layer.plotFlag === 0 || layer.plotFlag === false ? 0 : 1);
  }
  put(0, "ENDTAB");
  put(0, "ENDSEC");

  put(0, "SECTION");
  put(2, "BLOCKS");
  // The spaces are blocks too: the model and the sheet shown last are written as entities below, the other sheets nowhere.
  for (const block of space(/^(?![*$](model|paper)_space)./i)) {
    put(0, "BLOCK");
    put(8, "0");
    put(2, line(block.name));
    put(70, whole(block.flags));
    point(10, block.basePoint, true);
    for (const value of list(block.entities)) draw(value, false);
    put(0, "ENDBLK");
    put(8, "0");
  }
  put(0, "ENDSEC");

  put(0, "SECTION");
  put(2, "ENTITIES");
  for (const block of space(/^[*$]model_space$/i)) for (const value of list(block.entities)) draw(value, false);
  for (const block of space(/^[*$]paper_space$/i)) for (const value of list(block.entities)) draw(value, true);
  // What the reading left out is written as its type alone, for the reader to count as not read. A type the
  // reader draws is renamed: with no value of its own, it would be drawn as a point at the origin.
  const DRAWN = ["LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE", "INSERT", "TEXT", "MTEXT", "DIMENSION", "HATCH", "SOLID", "TRACE", "3DFACE", "LEADER", "ATTDEF", "POINT"];
  for (const type of Object.keys(record(unread))) {
    const mesh = type === "POLYLINE_MESH" ? 16 : type === "POLYLINE_PFACE" ? 64 : 0;
    const name = mesh ? "POLYLINE" : DRAWN.includes(named(type)) ? named(type) + "_NON_LU" : named(type);
    for (let count = whole(unread[type]); count > 0 && name !== ""; count -= 1) {
      put(0, name);
      put(8, "0");
      if (mesh) put(70, mesh);
    }
  }
  put(0, "ENDSEC");
  put(0, "EOF");
  flush();
  return true;
}
`;

/**
 * For a DWG of the R13, R14 or 2000 format, whose DXF LibreDWG's WebAssembly build breaks down writing: LibreDWG
 * reads the drawing, and the DXF is written here from what it read.
 */
export const DWG_DATABASE_SCRIPT = String.raw`
const { writeSync } = require("node:fs");
const input = JSON.parse(process.argv[1]);
// Records that belong to an entity or to a block, which LibreDWG hands over with it.
const PARTS = ["BLOCK", "ENDBLK", "SEQEND", "ATTRIB", "VERTEX_2D", "VERTEX_3D", "VERTEX_MESH", "VERTEX_PFACE", "VERTEX_PFACE_FACE"];
// Where LibreDWG's reading names a type otherwise than the drawing does.
const NAMES = { POLYLINE_2D: "POLYLINE2D", POLYLINE_3D: "POLYLINE3D", TABLE: "ACAD_TABLE", PROXY_ENTITY: "ACAD_PROXY_ENTITY", SECTIONOBJECT: "SECTION" };
(async () => {
  let chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const quiet = () => {};
  // The standard output carries the DXF and nothing else: LibreDWG's reading reports on the console.
  for (const method of ["log", "info", "debug", "warn", "error"]) console[method] = quiet;
  const { LibreDwg, createModule, Dwg_Object_Supertype, Dwg_Object_Type_Inverted } = await import(input.readerUrl);
  const libredwg = await createModule({ locateFile: (name) => input.wasmDirectory + name, print: quiet, printErr: quiet });
  const bytes = Buffer.concat(chunks);
  chunks = null;
  const version = bytes.subarray(0, 6).toString("latin1");
  // The DWG lives in the memory of the WebAssembly instance, never on the disk.
  libredwg.FS.writeFile("/in.dwg", bytes);
  const read = libredwg.dwg_read_file("/in.dwg");
  libredwg.FS.unlink("/in.dwg");
  if (!read.data || read.error >= 128) process.exit(3);
  const reader = LibreDwg.createByWasmInstance(libredwg);
  // What the drawing holds, by type, less what LibreDWG's reading hands over: the difference is written as
  // entities of that type and nothing else, so that who reads the DXF says they were left out.
  const unread = {}, defaults = {};
  for (let index = reader.dwg_get_num_objects(read.data) - 1; index >= 0; index -= 1) {
    const object = reader.dwg_get_object(read.data, index);
    if (!object || reader.dwg_object_get_supertype(object) !== Dwg_Object_Supertype.DWG_SUPERTYPE_ENTITY) continue;
    const name = String(Dwg_Object_Type_Inverted[reader.dwg_object_get_fixedtype(object)]).replace(/^DWG_TYPE_/, "");
    if (PARTS.includes(name)) continue;
    const type = NAMES[name] || (name.startsWith("DIMENSION_") ? "DIMENSION" : name);
    unread[type] = (unread[type] || 0) + 1;
    if (type !== "ATTDEF") continue;
    // The reading hands an attribute definition over without the text it holds: it is taken here, by handle.
    const entity = reader.dwg_object_to_entity(object), fields = reader.dwg_object_to_entity_tio(object);
    if (entity && fields) defaults[reader.dwg_object_entity_get_handle_object(entity).value.toString(16).toUpperCase()] = reader.dwg_dynapi_entity_data(fields, "default_value");
  }
  const database = reader.convert(read.data);
  for (const block of database.tables.BLOCK_RECORD.entries) {
    for (const entity of block.entities || []) {
      if (unread[entity.type] > 0) unread[entity.type] -= 1;
      if (entity.type === "ATTDEF" && entity.text && typeof defaults[entity.handle] === "string") entity.text.text = defaults[entity.handle];
    }
  }
  // The DXF leaves as it is written and nothing of it is kept here, so a drawing that grows past what the
  // server takes is stopped on its way.
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const drawn = writeDatabaseDxf(database, version, unread, (text) => {
    const buffer = Buffer.from(text, "utf8");
    for (let at = 0; at < buffer.length;) {
      try {
        at += writeSync(1, buffer, at, buffer.length - at);
      } catch (error) {
        if (error.code !== "EAGAIN") throw error;
        Atomics.wait(pause, 0, 0, 2);
      }
    }
  });
  process.exit(drawn ? 0 : 3);
})().catch(() => process.exit(2));
` + DWG_DATABASE_DXF_WRITER;
