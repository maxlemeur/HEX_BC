// SPDX-License-Identifier: GPL-3.0-or-later
//
// The one program that loads LibreDWG (GPL-3.0, here in its WebAssembly build
// @mlightcad/libredwg-web). It is not part of the application: the server runs
// it as a separate Node process (dwg-conversion-server.ts), hands it a DWG on
// its standard input and reads a DXF on its standard output. Nothing else is
// exchanged, and the process is started without the right to read or write
// the disk (its own two files apart), to open a connection or to start a
// program. This file, and only this file, is offered under the GNU General
// Public License, version 3 or later: https://www.gnu.org/licenses/gpl-3.0.html

/** Exit codes of the program: 0 with the DXF written out, otherwise nothing is written. */
export const DWG_CONVERSION_EXIT = { converted: 0, crashed: 2, refused: 3 } as const;

/** LibreDWG's own threshold: an error code from here on means the drawing was not read. */
const DWG_ERR_CRITICAL = 128;

export type DwgConversionScriptInput = {
  /** file: URL of the module that creates the WebAssembly instance. */
  moduleUrl: string;
  /** Directory of its .wasm file, with the closing separator. */
  wasmDirectory: string;
};

export const DWG_CONVERSION_SCRIPT = `
const input = JSON.parse(process.argv[1]);
(async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const quiet = () => {};
  const createModule = (await import(input.moduleUrl)).default;
  const libredwg = await createModule({ locateFile: (name) => input.wasmDirectory + name, print: quiet, printErr: quiet });
  // Both files live in the memory of the WebAssembly instance, never on the disk.
  libredwg.FS.writeFile("/in.dwg", Buffer.concat(chunks));
  const code = libredwg.dwg_write_dxf("/in.dwg", "/out.dxf");
  if (code >= ${DWG_ERR_CRITICAL}) process.exit(${DWG_CONVERSION_EXIT.refused});
  const dxf = libredwg.FS.readFile("/out.dxf");
  process.stdout.write(dxf, () => process.exit(${DWG_CONVERSION_EXIT.converted}));
})().catch(() => process.exit(${DWG_CONVERSION_EXIT.crashed}));
`;
