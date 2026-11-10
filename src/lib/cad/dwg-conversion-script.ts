// SPDX-License-Identifier: GPL-3.0-or-later
//
// The one program that loads LibreDWG (GPL-3.0-or-later, here in its
// WebAssembly build @mlightcad/libredwg-web). The application does not link
// it: the server (dwg-conversion-server.ts) hands this text to a Node process
// of its own, which gets a DWG on its standard input and writes a DXF on its
// standard output. Nothing else is exchanged, and the process is started
// without the right to read or write the disk (LibreDWG's two files apart),
// to open a connection or to start a program. This file, and only this file,
// is offered under the GNU General Public License, version 3 or later, whose
// text is in LICENSES/GPL-3.0-or-later.txt.
//
// The program is told, as its one argument, the JSON of `moduleUrl` (file: URL
// of the module that creates the WebAssembly instance) and `wasmDirectory`
// (directory of its .wasm file, with the closing separator). It exits with 0
// once the whole DXF is written out, with 3 when LibreDWG did not read the
// drawing (its error code is 128 or more), with 2 when anything else broke:
// what was written before a 2 or a 3 is not a drawing.

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
