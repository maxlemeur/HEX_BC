# CAD fixtures

These drawings are test data of the GNU LibreDWG 0.13.3 release
(<https://ftp.gnu.org/gnu/libredwg/libredwg-0.13.3.tar.xz>), unchanged. They are sample drawings of that project, with no
customer data.

| File here | File of the release, under `test/test-data/` | SHA-256 |
| --- | --- | --- |
| `libredwg-example-2018.dwg` | `example_2018.dwg` | `7bc7721224003062b237845842b7a976e46771c37eba6833b9ed3712e7a5a65a` |
| `libredwg-example-2000.dwg` | `example_2000.dwg` | `34574244d7556d1ef7b437443d9b3d1ad8662e1c669c42d80cff6a8a19799be9` |
| `libredwg-example-r13.dwg` | `example_r13.dwg` | `53558a8ae4bf666f906c9c2e4d3c3ee7ef61690e3b0f4d4a858e4e1bf555fc89` |
| `libredwg-door-r14.dwg` | `r14/v.dwg` | `e296ca50f237abb9eec1a8bdab77aa16fd59518e246df812aa4dd4f859bd12d3` |

The three `example` files are one drawing, tables and chairs on five layers, saved by AutoCAD in the 2018, 2000 and R13
formats; the last one is a door saved in the R14 format.

They are distributed with LibreDWG under the GNU General Public License, version 3 or later
(text in `LICENSES/GPL-3.0-or-later.txt` at the root of the repository), and are kept here under that licence, as test
data only: the conversion tests of `src/lib/cad/dwg-conversion-server.test.ts` read them, and the journey CAD03 reads
the 2018 and 2000 ones. They are not part of the application.
