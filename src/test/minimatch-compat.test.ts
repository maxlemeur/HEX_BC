// minimatch < 11.0.1 (GHSA-g3hv-75wg-m249) leaves the graph through two local packages:
// tools/minimatch-v3-api, the minimatch 3 call surface of eslint-plugin-import, -jsx-a11y and
// -react, and tools/glob-v7-api, the glob 7 surface of rimraf 2.7.1 (exceljs > unzipper >
// fstream). Both delegate to the patched releases. The expected values below were recorded
// from minimatch 3.1.5, glob 7.2.3 and rimraf 2.7.1 (lockfile integrity) by the scripts kept
// with the remediation evidence, outside the repository.
//
// Ways this can fail, each covered below:
// 1. A consumer still resolves minimatch 3.x or glob 7 (override path, hoisting), or a package
//    resolves its own copy instead of delegating to minimatch 11.0.3 / glob 14.0.3.
// 2. A missing export or call shape: callable require() result, Babel `_interopRequireDefault`
//    `.default`, `new Minimatch(pattern).match(path)`, `makeRe(pattern).test(string)` and
//    `makeRe` returning false for comments and empty patterns; an ESM default import.
// 3. Another answer than 3.1.5 for what the plugins pass: JSX names (react, jsx-a11y,
//    noglobstar), import specifiers and absolute file paths (import rules, nocomment, matchBase,
//    user patternOptions), regular-expression tests of normalized steps (no-internal-modules).
// 4. Pattern normalization: trimming, comments, empty patterns, negation, flipNegate, nonegate,
//    dot, nocase, matchBase, noglobstar, nobrace, noext.
// 5. A construct whose meaning differs between 3.1.5 and 11.0.3 (bracket expressions, extglob
//    adjacency and negation, escaped @, stray | and ), adjacent or many **, `.`/`..` and
//    dot-led portions, regular-expression semantics of ** and classes; a *, ?, +, @ or !
//    that 3.1.5 moves after a following ], or after a ) or | outside extglobs, as in the
//    Next.js segments [id] and (group); [.]; braces after ${; non-ASCII characters with nocase;
//    astral characters; an extglob whose ) or | lies in a later portion, since both releases
//    parse each portion alone; empty extglobs; a \ before a line terminator; {} with braces;
//    a line terminator in a makeRe test) answered silently instead of rejected with a TypeError.
// 6. An unsupported option or argument (partial, debug, optimizationLevel, non-boolean value,
//    a second match() argument) silently accepted.
// 7. Windows: backslashes separate portions as in 3.x; UNC roots and drive-letter case
//    differences are rejected.
// 8. The advisory's amplification pattern or deeply nested extglobs become slow, end in a
//    RangeError, or optimizationLevel >= 2 becomes reachable.
// 9. A plugin rule changes outcome through the real consumer.
// 10. rimraf: hasMagic counts braces like glob 7; an existing path with glob characters is
//     removed literally and a missing one expands to the same files (sync and async), with the
//     case-sensitive wildcards of glob 7 on macOS and Windows too; other patterns and options,
//     including a literal portion after ** that glob 7 finds by stat, are rejected,
//     asynchronously through the callback. hasMagic is true wherever glob 7 may see a glob
//     character, so that a missing path reaches those refusals instead of a silent literal
//     no-op; ? is rejected, since glob 14 reads one code point where glob 7 reads one UTF-16
//     unit (astral file names such as a😀.txt).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

type Options = Record<string, boolean>;
type Row = [pattern: string, ...cells: string[]];
interface MinimatchV3 {
  (path: string, pattern: string, options?: Options): boolean;
  Minimatch: new (pattern: string, options?: Options) => { match(path: string): boolean };
  makeRe(pattern: string, options?: Options): false | { test(value: string): boolean };
}
type Callback = (error: Error | null, results?: string[]) => void;
interface GlobV7 {
  (pattern: string, options: Options, callback: Callback): void;
  sync(pattern: string, options?: Options): string[];
  hasMagic(pattern: string, options?: Options): boolean;
}
type Rimraf = ((target: string, callback: (error: Error | null) => void) => void) & {
  sync(target: string): void;
};

const root = fileURLToPath(new URL("../..", import.meta.url));
const rootRequire = createRequire(path.join(root, "package.json"));
const nextRequire = createRequire(path.join(root, "node_modules/eslint-config-next/package.json"));
const pluginEntries = ["eslint-plugin-import", "eslint-plugin-jsx-a11y", "eslint-plugin-react"]
  .map((name) => nextRequire.resolve(name));
const minimatchEntry = () => createRequire(pluginEntries[0]).resolve("minimatch");
const loadMinimatch = () => createRequire(pluginEntries[0])("minimatch") as MinimatchV3;
const rimrafEntry = () => [rootRequire.resolve("exceljs"), "unzipper", "fstream", "rimraf"]
  .reduce((from, name) => createRequire(from).resolve(name));
const globEntry = () => createRequire(rimrafEntry()).resolve("glob");

// The nearest package.json with a name: dist/commonjs/package.json only sets the module type.
function packageOf(entry: string): { directory: string; name?: string; version?: string } {
  for (let directory = path.dirname(entry); ; directory = path.dirname(directory)) {
    const file = path.join(directory, "package.json");
    const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    if (manifest.name) return { directory, ...manifest };
  }
}

const OPTIONS: Record<string, Options> = {
  "": {}, G: { noglobstar: true }, C: { nocomment: true }, B: { matchBase: true }, D: { dot: true },
  I: { nocase: true }, N: { nonegate: true }, F: { flipNegate: true }, E: { noext: true },
  R: { nobrace: true }, CD: { nocomment: true, dot: true }, BI: { matchBase: true, nocase: true },
};

// "1" match, "0" no match, "x" TypeError: a construct the package rejects because 3.1.5 and
// 11.0.3 can disagree on it.
function mismatches(rows: Row[], subjects: string[], run: (pattern: string, options: Options, subject: string) => boolean) {
  const found: string[] = [];
  for (const [pattern, ...cells] of rows) {
    for (const cell of cells) {
      const [key, bits] = cell.split(":");
      subjects.forEach((subject, index) => {
        let actual: string;
        try {
          actual = run(pattern, OPTIONS[key], subject) ? "1" : "0";
        } catch (error) {
          actual = error instanceof TypeError ? "x" : String(error);
        }
        if (actual !== bits[index]) {
          found.push(`${JSON.stringify(pattern)} ${key || "-"} ${JSON.stringify(subject)}: ${bits[index]} != ${actual}`);
        }
      });
    }
  }
  return found;
}

const NAMES_SUBJECTS = ["CustomInput", "Custom", "custom", "MyInput", "Form.Input", "Form.Group.Input", "input",
  "HtmlBlock", "Html", "Ignored_Thing", "Other_Thing", "_Private", "data-testid", "renderItem", "Renderer", "", "a.b",
  ".hidden"];
const NAMES: Row[] = [
  ["Custom*", ":110000000000000000", "G:110000000000000000"],
  ["*Input", ":100111000000000000", "G:100111000000000000"],
  ["*", ":111111111111111010", "G:111111111111111010"],
  ["?ustom*", ":111000000000000000", "G:111000000000000000"],
  ["Form.*", ":000011000000000000", "G:000011000000000000"],
  ["Form.**", ":000011000000000000", "G:000011000000000000"],
  ["**", ":111111111111111110", "G:111111111111111010"],
  ["*.*", ":000011000000000010", "G:000011000000000010"],
  ["Html?lock", ":000000010000000000", "G:000000010000000000"],
  ["[A-Z]*", ":110111011110001000", "G:110111011110001000"],
  ["[!a-z]*", ":110111011111001000", "G:110111011111001000"],
  ["{Custom,My}Input", ":100100000000000000", "G:100100000000000000"],
  ["+(Custom|My)Input", ":100100000000000000", "G:100100000000000000"],
  ["@(Html|Form)*", ":000011011000000000", "G:000011011000000000"],
  ["!(Custom)", ":111111111111111111", "G:111111111111111111"],
  ["Custom\\*", ":000000000000000000", "G:000000000000000000"],
  ["#comment", ":000000000000000000", "G:000000000000000000"],
  ["!Custom*", ":001111111111111111", "G:001111111111111111"],
  ["!!Custom*", ":110000000000000000", "G:110000000000000000"],
  ["data-*", ":000000000000100000", "G:000000000000100000"],
  ["render*", ":000000000000010000", "G:000000000000010000"],
  ["*_*", ":000000000111000000", "G:000000000111000000"],
  ["Ignored_*", ":000000000100000000", "G:000000000100000000"],
  ["", ":000000000000000100", "G:000000000000000100"],
  [" Custom* ", ":110000000000000000", "G:110000000000000000"],
  [".*", ":000000000000000001", "G:000000000000000001"],
  ["[[:upper:]]*", ":xxxxxxxxxxxxxxxxxx", "G:xxxxxxxxxxxxxxxxxx"],
  ["!(Custom)*", ":111111111111111111", "G:111111111111111111"],
  ["[z-a]*", ":xxxxxxxxxxxxxxxxxx", "G:xxxxxxxxxxxxxxxxxx"],
  ["\\@x", ":xxxxxxxxxxxxxxxxxx", "G:xxxxxxxxxxxxxxxxxx"],
  ["*|", ":xxxxxxxxxxxxxxxxxx", "G:xxxxxxxxxxxxxxxxxx"],
];

const PATHS_SUBJECTS = ["./styles.css", "./side-effect.js", "../b", "..", ".", "@/lib/money",
  "@/components/ui/button", "react", "react-dom/client", "node:fs", "zod/v4", "lodash/fp", "~/utils/x", "@app/x/y",
  "a.css", "/repo/src/a.test.ts", "/repo/src/test/x.ts", "/repo/src/__tests__/a.ts", "/repo/client/sub-module/a.js",
  "/repo/client/other/a.js", "/repo/.storybook/main.js", "/repo/src/.eslintrc.js", "src\\styles\\a.css"];
const PATHS: Row[] = [
  ["**/*.css", ":00000000000000100000001", "C:00000000000000100000001", "B:00000000000000100000001", "D:00000000000000100000001", "I:00000000000000100000001", "N:00000000000000100000001", "F:00000000000000100000001", "E:00000000000000100000001", "R:00000000000000100000001", "G:00000000000000000000000", "CD:00000000000000100000001", "BI:00000000000000100000001"],
  ["*.css", ":00000000000000100000001", "C:00000000000000100000001", "B:10000000000000100000001"],
  ["./*.css", ":10000000000000000000000", "C:10000000000000000000000", "B:10000000000000000000000"],
  ["{.,..}/**/*.css", ":10000000000000000000000", "C:10000000000000000000000", "B:10000000000000000000000", "D:10000000000000000000000", "I:10000000000000000000000", "N:10000000000000000000000", "F:10000000000000000000000", "E:10000000000000000000000", "R:00000000000000000000000", "G:00000000000000000000000", "CD:10000000000000000000000", "BI:10000000000000000000000"],
  ["@/**", ":00000110000000000000000", "C:00000110000000000000000", "B:00000110000000000000000", "D:00000110000000000000000", "I:00000110000000000000000", "N:00000110000000000000000", "F:00000110000000000000000", "E:00000110000000000000000", "R:00000110000000000000000", "G:00000000000000000000000", "CD:00000110000000000000000", "BI:00000110000000000000000"],
  ["@/components/**", ":00000010000000000000000", "C:00000010000000000000000", "B:00000010000000000000000"],
  ["~/**", ":00000000000010000000000", "C:00000000000010000000000", "B:00000000000010000000000"],
  ["@app/**", ":00000000000001000000000", "C:00000000000001000000000", "B:00000000000001000000000"],
  ["react", ":00000001000000000000000", "C:00000001000000000000000", "B:00000001000000000000000"],
  ["react*", ":00000001000000000000000", "C:00000001000000000000000", "B:00000001000000000000000"],
  ["react-dom/*", ":00000000100000000000000", "C:00000000100000000000000", "B:00000000100000000000000"],
  ["@(react|react-dom)", ":00000001000000000000000", "C:00000001000000000000000", "B:00000001000000000000000", "D:00000001000000000000000", "I:00000001000000000000000", "N:00000001000000000000000", "F:00000001000000000000000", "E:00000000000000000000000", "R:00000001000000000000000", "G:00000001000000000000000", "CD:00000001000000000000000", "BI:00000001000000000000000"],
  ["node:*", ":00000000010000000000000", "C:00000000010000000000000", "B:00000000010000000000000"],
  ["**/*.test.ts", ":00000000000000010000000", "C:00000000000000010000000", "B:00000000000000010000000"],
  ["**/*.{test,spec}.ts", ":00000000000000010000000", "C:00000000000000010000000", "B:00000000000000010000000"],
  ["**/__tests__/**", ":00000000000000000100000", "C:00000000000000000100000", "B:00000000000000000100000"],
  ["/repo/src/**/*", ":00000000000000011100000", "C:00000000000000011100000", "B:00000000000000011100000", "D:00000000000000011100010", "I:00000000000000011100000", "N:00000000000000011100000", "F:00000000000000011100000", "E:00000000000000011100000", "R:00000000000000011100000", "G:00000000000000001100000", "CD:00000000000000011100010", "BI:00000000000000011100000"],
  ["/repo/client/!(sub-module)/**/*", ":00000000000000000001000", "C:00000000000000000001000", "B:00000000000000000001000", "D:00000000000000000001000", "I:00000000000000000001000", "N:00000000000000000001000", "F:00000000000000000001000", "E:00000000000000000000000", "R:00000000000000000001000", "G:00000000000000000000000", "CD:00000000000000000001000", "BI:00000000000000000001000"],
  ["/repo/{client,src}/**", ":00000000000000011111000", "C:00000000000000011111000", "B:00000000000000011111000"],
  ["**/*/main.js", ":00000000000000000000000", "C:00000000000000000000000", "B:00000000000000000000000"],
  ["zod/*", ":00000000001000000000000", "C:00000000001000000000000", "B:00000000001000000000000"],
  ["lodash/*", ":00000000000100000000000", "C:00000000000100000000000", "B:00000000000100000000000"],
  ["#x", ":00000000000000000000000", "C:00000000000000000000000", "B:00000000000000000000000", "D:00000000000000000000000", "I:00000000000000000000000", "N:00000000000000000000000", "F:00000000000000000000000", "E:00000000000000000000000", "R:00000000000000000000000", "G:00000000000000000000000", "CD:00000000000000000000000", "BI:00000000000000000000000"],
  ["!**/*.css", ":11111111111111011111110", "C:11111111111111011111110", "B:11111111111111011111110", "D:11111111111111011111110", "I:11111111111111011111110", "N:00000000000000000000000", "F:00000000000000100000001", "E:11111111111111011111110", "R:11111111111111011111110", "G:11111111111111111111111", "CD:11111111111111011111110", "BI:11111111111111011111110"],
  ["**/.*", ":xxxxx000000000000000010", "C:xxxxx000000000000000010", "B:xxxxx000000000000000010", "D:xxxxx000000000000000010", "I:xxxxx000000000000000010", "N:xxxxx000000000000000010", "F:xxxxx000000000000000010", "E:xxxxx000000000000000010", "R:xxxxx000000000000000010", "G:xxxxx000000000000000000", "CD:xxxxx000000000000000010", "BI:xxxxx000000000000000010"],
  ["/repo/**/*.js", ":00000000000000000011000", "C:00000000000000000011000", "B:00000000000000000011000"],
  ["**/test/**/*.ts", ":00000000000000001000000", "C:00000000000000001000000", "B:00000000000000001000000"],
  ["**/src/**/.*", ":xxxxx000000000000000xx0", "C:xxxxx000000000000000xx0", "B:xxxxx000000000000000xx0"],
  ["**/a/**/b/**", ":xxxxxxxxxxxxxxxxxxxxxxx", "C:xxxxxxxxxxxxxxxxxxxxxxx", "B:xxxxxxxxxxxxxxxxxxxxxxx"],
  ["**/**", ":xxxxxxxxxxxxxxxxxxxxxxx", "C:xxxxxxxxxxxxxxxxxxxxxxx", "B:xxxxxxxxxxxxxxxxxxxxxxx"],
  [".*", ":xxxxx000000000000000000", "C:xxxxx000000000000000000", "B:xxxxx000000000000000010"],
  ["*/*", ":00000000101100000000000", "C:00000000101100000000000", "B:00000000101100000000000"],
  ["../*", ":00100000000000000000000", "C:00100000000000000000000", "B:00100000000000000000000"],
  ["..", ":00010000000000000000000", "C:00010000000000000000000", "B:00010000000000000000000"],
  [".?", ":xxxxx000000000000000000", "C:xxxxx000000000000000000", "B:xxxxx000000000000000000"],
];

// import/no-internal-modules tests the joined steps, "/" + steps and the resolved path.
// "F": makeRe returns false, as 3.1.5 does for comments, empty patterns and empty brace sets.
const MAKE_RE_SUBJECTS = ["lodash/fp", "/lodash/fp", "lodash/fp/map", "zod/v4", "/zod/v4", "@/components/ui",
  "/@/components/ui", "exceljs/lib/exceljs.nodejs", "/repo/node_modules/lodash/fp.js", "source-map-support/register",
  "", "/", "lodash//fp", "lodash/./fp", "lodash/fp/"];
const MAKE_RE: Row[] = [
  ["lodash/*", ":100000000000xxx", "I:100000000000xxx"],
  ["zod/*", ":000100000000xxx", "I:000100000000xxx"],
  ["@/components/*", ":000001000000xxx", "I:000001000000xxx"],
  ["source-map-support/*", ":000000000100xxx", "I:000000000100xxx"],
  ["exceljs/lib/*", ":000000010000xxx", "I:000000010000xxx"],
  ["lodash/{fp,map}", ":100000000000xxx", "I:100000000000xxx"],
  ["lodash/+(fp|map)", ":100000000000xxx", "I:100000000000xxx"],
  ["lodash/f?", ":100000000000xxx", "I:100000000000xxx"],
  ["!lodash/*", ":011111111111xxx", "I:011111111111xxx"],
  ["/repo/node_modules/*/fp.js", ":000000001000xxx", "I:000000001000xxx"],
  ["", ":F", "I:F"],
  ["#c", ":F", "I:F"],
  ["{,}", ":F", "I:F"],
  ["**/actions/*", ":xxxxxxxxxxxxxxx", "I:xxxxxxxxxxxxxxx"],
  ["lodash/**", ":xxxxxxxxxxxxxxx", "I:xxxxxxxxxxxxxxx"],
  ["*/fp", ":xxxxxxxxxxxxxxx", "I:xxxxxxxxxxxxxxx"],
  ["lodash/[a-z]*", ":xxxxxxxxxxxxxxx", "I:xxxxxxxxxxxxxxx"],
  ["lodash/!(fp)", ":xxxxxxxxxxxxxxx", "I:xxxxxxxxxxxxxxx"],
];

// [pattern, subject, options, minimatch 3.1.5 answer]: minimatch 11.0.3 gives the other answer.
const DIFFERENT: Array<[string, string, Options, boolean]> = [
  ["/repo/src/app/**/\\[*]/**", "/repo/src/app/portal/[token]/page.tsx", {}, false],
  ["src/app/(*)/page.tsx", "src/app/(auth)/page.tsx", {}, false],
  ["*]", "a]", {}, false],
  ["*]", "]a", {}, true],
  ["*a+]", "xa+]", {}, false],
  ["(a*|b)", "(ax|b)", {}, false],
  ["[.]env", ".env", {}, false],
  ["[.]", ".", { dot: true }, false],
  ["b${,}{a,b}", "b${,}a", {}, false],
  ["k*", "\u212Aelvin", { nocase: true }, false],
  ["s*", "\u017Ftyle", { nocase: true }, false],
  ["?", "\u{1F600}", {}, false],
  ["[!a]", "\u{1F600}", {}, false],
  ["@(src/*)", "@(src/x)", {}, false],
  ["*(src/lib)/x", "a(src/lib)/x", {}, true],
  ["a?(/a)", "a.(/a)", {}, true],
  ["src/@(app/*|lib/*)", "src/@(app/x|lib/y)", {}, false],
  ["@()", "@()", {}, false],
  ["*()", "x()", {}, false],
  ["a\\\nb", "a\nb", {}, false],
  ["a\\\u2028b", "a\u2028b", {}, false],
  ["{,{}}{},}", "{}", {}, false],
];
// [pattern, tested string, answer of the minimatch 3.1.5 regular expression].
const DIFFERENT_MAKE_RE: Array<[string, string, boolean]> = [
  ["lodash/*]", "lodash/x]", false],
  ["app/(*)/x", "app/(a)/x", false],
  ["!lodash/*", "a\nb", false],
  ["!lodash/*", "a\u2029b", false],
];

// Recorded with the path module of minimatch 3.1.5 replaced by path.win32.
const WIN32_SUBJECTS = ["C:\\repo\\src\\a.js", "C:/repo/src/a.js", "c:\\repo\\src\\a.js", "src\\styles\\a.css",
  "src/styles/a.css", "C:\\repo\\client\\other\\a.js", "C:\\repo\\client\\sub-module\\a.js", "\\\\srv\\share\\a.js",
  "CustomInput"];
const WIN32: Row[] = [
  ["C:\\repo\\src\\**", ":11x0000x0", "I:11x0000x0"],
  ["C:/repo/src/**/*.js", ":11x0000x0", "I:11x0000x0"],
  ["C:\\repo\\client\\!(sub-module)\\**\\*", ":00x0010x0", "I:00x0010x0"],
  ["src\\styles\\*.css", ":0001100x0", "I:0001100x0"],
  ["**\\*.css", ":0001100x0", "I:0001100x0"],
  ["**/*.css", ":0001100x0", "I:0001100x0"],
  ["Custom*", ":0000000x1", "I:0000000x1"],
  ["\\\\srv\\share\\**", ":xxxxxxxxx", "I:xxxxxxxxx"],
];

// [rule, options, code, file] and the messages recorded with minimatch 3.1.5.
const LINT_CASES: Array<[string, unknown, string, string, string[]]> = [
  ["react/jsx-pascal-case", { ignore: ["Ignored_*"] },
    "const a = <Ignored_Thing />;\nconst b = <Other_Thing />;", "src/zz-case.jsx", ["react/jsx-pascal-case:2:11"]],
  ["react/no-danger", { customComponentNames: ["Html*"] },
    "const a = <HtmlBlock dangerouslySetInnerHTML={{ __html: x }} />;\nconst b = <TextBlock dangerouslySetInnerHTML={{ __html: x }} />;",
    "src/zz-case.jsx", ["react/no-danger:1:22"]],
  ["react/forbid-component-props", { forbid: [{ propNamePattern: "data-*", allowedForPatterns: ["Allowed*"] }] },
    "const a = <AllowedBox data-id=\"1\" />;\nconst b = <OtherBox data-id=\"2\" />;", "src/zz-case.jsx",
    ["react/forbid-component-props:2:21"]],
  ["react/jsx-handler-names", { ignoreComponentNames: ["Custom*"] },
    "const a = <CustomButton onClick={this.doIt} />;\nconst b = <Button onClick={this.doIt} />;", "src/zz-case.jsx",
    ["react/jsx-handler-names:2:19"]],
  ["react/no-unstable-nested-components", { allowAsProps: false, propNamePattern: "render*" },
    "function A() { return <List renderItem={() => <div />} />; }\nfunction B() { return <List item={() => <div />} />; }",
    "src/zz-case.jsx", ["react/no-unstable-nested-components:2:35"]],
  ["jsx-a11y/label-has-associated-control", { controlComponents: ["Custom*"], assert: "nesting", depth: 3 },
    "const a = <label>Nom<CustomInput /></label>;\nconst b = <label>Nom<span /></label>;", "src/zz-case.jsx",
    ["jsx-a11y/label-has-associated-control:2:11"]],
  ["import/no-unassigned-import", { allow: ["**/*.css"] },
    "import './styles.css';\nimport './side-effect.js';", "src/zz-case.js", ["import/no-unassigned-import:2:1"]],
  ["import/no-namespace", { ignore: ["*.css"] },
    "import * as s from './a.css';\nimport * as t from './b.js';", "src/zz-case.js", ["import/no-namespace:2:8"]],
  ["import/no-internal-modules", { allow: ["zod/*"] },
    "import a from 'zod/v4';\nimport b from 'exceljs/lib/exceljs.nodejs';", "src/zz-case.js",
    ["import/no-internal-modules:2:15"]],
  ["import/no-internal-modules", { forbid: ["exceljs/lib/*"] },
    "import a from 'zod/v4';\nimport b from 'exceljs/lib/exceljs.nodejs';", "src/zz-case.js",
    ["import/no-internal-modules:2:15"]],
  ["import/extensions", ["always", { ignorePackages: true, pathGroupOverrides: [{ pattern: "./mon*", action: "ignore" }] }],
    "import a from './money';\nimport b from './utils';", "src/lib/zz-case.js", ["import/extensions:2:15"]],
  ["import/no-restricted-paths", { zones: [
    { target: "./src/components/**/*", from: "./src/lib/**/*", except: [path.join(root, "src/lib/money*")] },
    { target: "./src/!(components)/**/*", from: "./src/components/**/*" }] },
    "import a from '../lib/money';\nimport b from '../lib/utils';", "src/components/zz-case.js",
    ["import/no-restricted-paths:2:15"]],
  ["import/no-restricted-paths", { zones: [{ target: "./src/!(components)/**/*", from: "./src/components/**/*" }] },
    "import a from '../components/ui/button';", "src/lib/zz-case.js", ["import/no-restricted-paths:1:15"]],
  ["import/no-import-module-exports", { exceptions: [path.join(root, "src/*-exempt.js")] },
    "import a from 'zod';\nmodule.exports = a;", "src/zz-exempt.js", []],
  ["import/no-import-module-exports", { exceptions: [path.join(root, "src/*-exempt.js")] },
    "import a from 'zod';\nmodule.exports = a;", "src/zz-case.js", ["import/no-import-module-exports:1:1"]],
];

// glob 7.2.3 sees magic in more patterns than glob 14 ({a}, [1], a{,}b, a\\*b, a(b), a[, a]):
// these are true, so rimraf stats first, removes an existing path literally as glob 7 does, and
// sends a missing one to the refusals instead of treating it silently as a literal.
const GLOB_HAS_MAGIC: Array<[string, boolean]> = [
  ["/tmp/x/plain.txt", false], ["/tmp/x/a*", true], ["/tmp/x/a?.txt", true], ["/tmp/x/[ab].txt", true],
  ["/tmp/x/{a,b}.txt", true], ["/tmp/x/{a}.txt", true], ["/tmp/x/+(a|b).txt", true], ["/tmp/x/!(a).txt", true],
  ["/tmp/x/a\\*b", true], ["/tmp/x/a(b).txt", true], ["/tmp/x/.hidden", false], ["relative/a*", true],
  ["a{b,c}d", true], ["/tmp/x/a[", true], ["/tmp/x/a]", true], ["/tmp/x/report[1].xlsx", true], ["/tmp/x/a{,}b", true],
];
// Files that rimraf 2.7.1 removed through glob 7.2.3 from the fixture below. glob 7 never folds
// the case of a wildcard portion, so a*.txt keeps A5.txt on macOS and Windows too.
const RIMRAF_REMOVED: Array<[string, string[]]> = [
  ["lit*eral.txt", ["lit*eral.txt"]],
  ["a*.txt", ["a1.txt", "a2.txt", "a\u{1F600}.txt"]],
  ["*5.txt", ["A5.txt"]],
  ["sub/*.txt", ["sub/a3.txt"]],
  ["sub/**/*.txt", ["sub/a3.txt", "sub/deep/a4.txt"]],
  ["nope*", []],
  ["{a1,b}.txt", ["a1.txt", "b.txt"]],
];

describe("minimatch 3 call surface for the ESLint plugins", () => {
  it("is what every plugin resolves, and delegates to minimatch 11.0.3", () => {
    for (const entry of pluginEntries) {
      const resolved = packageOf(createRequire(entry).resolve("minimatch"));
      expect(resolved.name).toBe("@mergeone/minimatch-v3-api");
      const delegate = packageOf(createRequire(path.join(resolved.directory, "index.cjs")).resolve("minimatch-11"));
      expect([delegate.name, delegate.version]).toEqual(["minimatch", "11.0.3"]);
    }
  });

  it("keeps the require, Babel interop and ESM shapes and nothing else", async () => {
    const minimatch = loadMinimatch();
    const interop = (value: unknown) => (value as { __esModule?: boolean }).__esModule ? value : { default: value };
    expect((interop(minimatch) as { default: MinimatchV3 }).default("CustomInput", "Custom*")).toBe(true);
    expect(new minimatch.Minimatch("/repo/src/**/*").match("/repo/src/a.test.ts")).toBe(true);
    expect((minimatch.makeRe("lodash/*") as { test(value: string): boolean }).test("lodash/fp")).toBe(true);
    const esm = await import(pathToFileURL(minimatchEntry()).href) as { default: MinimatchV3 };
    expect(esm.default("CustomInput", "Custom*")).toBe(true);
    for (const member of ["filter", "match", "braceExpand", "defaults", "GLOBSTAR", "sep", "escape"]) {
      expect(minimatch).not.toHaveProperty(member);
    }
  });

  it("answers like minimatch 3.1.5 for JSX names, import paths and absolute files", () => {
    const minimatch = loadMinimatch();
    expect(mismatches(NAMES, NAMES_SUBJECTS, (pattern, options, subject) => minimatch(subject, pattern, options))).toEqual([]);
    expect(mismatches(PATHS, PATHS_SUBJECTS, (pattern, options, subject) => minimatch(subject, pattern, options))).toEqual([]);
    expect(mismatches(PATHS, PATHS_SUBJECTS, (pattern, options, subject) =>
      new minimatch.Minimatch(pattern, options).match(subject))).toEqual([]);
  });

  it("tests normalized steps like minimatch 3.1.5 regular expressions", () => {
    const minimatch = loadMinimatch();
    const found: string[] = [];
    for (const [pattern, ...cells] of MAKE_RE) {
      for (const cell of cells) {
        const [key, bits] = cell.split(":");
        if (bits === "F") {
          if (minimatch.makeRe(pattern, OPTIONS[key]) !== false) found.push(`${pattern} ${key}: expected false`);
          continue;
        }
        found.push(...mismatches([[pattern, cell]], MAKE_RE_SUBJECTS, (p, options, subject) =>
          (minimatch.makeRe(p, options) as { test(value: string): boolean }).test(subject)));
      }
    }
    expect(found).toEqual([]);
  });

  it("rejects the constructs on which minimatch 11.0.3 answers otherwise than 3.1.5", () => {
    const minimatch = loadMinimatch();
    const patched = createRequire(minimatchEntry())("minimatch-11") as {
      minimatch(path: string, pattern: string, options: object): boolean;
    };
    const answered: string[] = [];
    const answer = (label: string, run: () => unknown) => {
      try {
        answered.push(`${label}: ${String(run())}`);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
      }
    };
    for (const [pattern, subject, options, recorded] of DIFFERENT) {
      expect([pattern, subject, patched.minimatch(subject, pattern, { ...options, optimizationLevel: 0 })])
        .toEqual([pattern, subject, !recorded]);
      answer(`${pattern} ${subject}`, () => minimatch(subject, pattern, options));
      answer(`new ${pattern} ${subject}`, () => new minimatch.Minimatch(pattern, options).match(subject));
    }
    for (const [pattern, subject, recorded] of DIFFERENT_MAKE_RE) {
      expect([pattern, patched.minimatch(subject, pattern, { optimizationLevel: 0 })]).toEqual([pattern, !recorded]);
      answer(`makeRe ${pattern} ${subject}`, () =>
        (minimatch.makeRe(pattern) as { test(value: string): boolean }).test(subject));
    }
    expect(answered).toEqual([]);
  });

  it("rejects options and arguments outside that surface instead of ignoring them", () => {
    const minimatch = loadMinimatch();
    const loose = minimatch as unknown as (...args: unknown[]) => boolean;
    for (const option of ["partial", "debug", "allowWindowsEscape", "optimizationLevel", "platform", "nonull",
      "windowsPathsNoEscape", "preserveMultipleSlashes", "magicalBraces", "maxGlobstarRecursion", "nocaseMagicOnly"]) {
      expect(() => minimatch("a", "a", { [option]: true })).toThrow(/@mergeone\/minimatch-v3-api.*option/);
    }
    expect(() => loose("a", "a", { dot: "yes" })).toThrow(TypeError);
    expect(() => loose("a", 1)).toThrow(new TypeError("invalid pattern"));
    expect(() => minimatch("a", "a".repeat(64 * 1024 + 1))).toThrow(new TypeError("pattern is too long"));
    expect(() => loose(undefined, "a")).toThrow(TypeError);
    const matcher = new minimatch.Minimatch("a/*") as unknown as { match(...args: unknown[]): boolean };
    expect(() => matcher.match("a/b", true)).toThrow(TypeError);
    expect(() => minimatch.makeRe("lodash/*", { matchBase: true })).toThrow(TypeError);
    expect(() => minimatch.makeRe("lodash/*", { flipNegate: true })).toThrow(TypeError);
    expect(() => minimatch("x", "[[:upper:]]")).toThrow(/@mergeone\/minimatch-v3-api.*minimatch 3\.1\.5/);
  });

  it("keeps the advisory's amplification pattern and deeply nested extglobs fast", () => {
    const result = spawnSync(process.execPath, ["-e", `
      const minimatch = require(${JSON.stringify(minimatchEntry())});
      const outcome = (run) => { try { return run(); } catch (error) { return error.constructor.name; } };
      const amplified = (n) => "a/" + "**/../b/c/".repeat(n) + "d";
      const nested = (n) => "@(".repeat(n) + "a" + ")".repeat(n);
      const started = performance.now();
      const results = [
        outcome(() => minimatch("a/b/c/d", amplified(2))),
        outcome(() => minimatch("a/x/../b/c/x/../b/c/d", amplified(2))),
        outcome(() => new minimatch.Minimatch(amplified(20)).match("a/b/c/d")),
        outcome(() => new minimatch.Minimatch(amplified(5000)).match("a/b/c/d")),
        outcome(() => minimatch("a/b", "a/**", { optimizationLevel: 2 })),
        outcome(() => minimatch("a", nested(64))),
        outcome(() => minimatch("a", nested(2000))),
        outcome(() => minimatch("a", nested(20000))),
      ];
      process.stdout.write(JSON.stringify({ results, ms: performance.now() - started }));
    `], { encoding: "utf8", timeout: 5_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const { results, ms } = JSON.parse(result.stdout) as { results: unknown[]; ms: number };
    expect(results).toEqual([false, "TypeError", "TypeError", "TypeError", "TypeError", true, "TypeError", "TypeError"]);
    expect(ms).toBeLessThan(1_000);
  });

  it("reads Windows separators like minimatch 3.1.5", () => {
    const result = spawnSync(process.execPath, ["-e", `
      const minimatch = require(${JSON.stringify(minimatchEntry())});
      const [rows, subjects] = JSON.parse(process.argv[1]);
      const found = [];
      for (const [pattern, ...cells] of rows) for (const cell of cells) {
        const [key, bits] = cell.split(":");
        subjects.forEach((subject, index) => {
          let actual;
          try { actual = minimatch(subject, pattern, key ? { nocase: true } : {}) ? "1" : "0"; }
          catch (error) { actual = error instanceof TypeError ? "x" : String(error); }
          if (actual !== bits[index]) found.push(pattern + " " + key + " " + subject + ": " + bits[index] + " != " + actual);
        });
      }
      process.stdout.write(JSON.stringify(found));
    `, JSON.stringify([WIN32, WIN32_SUBJECTS])], {
      encoding: "utf8", timeout: 10_000, env: { ...process.env, __MINIMATCH_TESTING_PLATFORM__: "win32" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
  });

  it("keeps the outcome of every plugin rule that matches globs", () => {
    const { Linter } = rootRequire("eslint") as typeof import("eslint");
    const plugins = {
      react: nextRequire("eslint-plugin-react"),
      "jsx-a11y": nextRequire("eslint-plugin-jsx-a11y"),
      import: nextRequire("eslint-plugin-import"),
    };
    const outcomes = LINT_CASES.map(([rule, options, code, file]) => new Linter({ configType: "flat", cwd: root })
      .verify(code, [{
        files: ["**/*.js", "**/*.jsx"],
        plugins,
        languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
        settings: { react: { version: "19.3" }, "import/resolver": { node: { extensions: [".js", ".ts", ".tsx"] } } },
        rules: { [rule]: ["error", ...([] as unknown[]).concat(options)] },
      }], path.join(root, file))
      .map((message) => message.fatal ? `fatal:${message.message}` : `${message.ruleId}:${message.line}:${message.column}`));
    expect(outcomes).toEqual(LINT_CASES.map((testCase) => testCase[4]));
  });
});

describe("glob 7 call surface for rimraf", () => {
  const fixture = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mergeone-rimraf-"));
    fs.mkdirSync(path.join(directory, "sub/deep"), { recursive: true });
    for (const file of ["a1.txt", "a2.txt", "A5.txt", "a\u{1F600}.txt", "b.txt", ".hidden", "lit*eral.txt", "literal.txt",
      "sub/a3.txt", "sub/.x", "sub/deep/a4.txt"]) fs.writeFileSync(path.join(directory, file), file);
    fs.symlinkSync(path.join(directory, "sub"), path.join(directory, "link"), "dir");
    fs.symlinkSync(path.join(directory, "missing"), path.join(directory, "dangling"));
    return directory;
  };
  // Symbolic links are listed, never followed.
  const files = (directory: string, prefix = ""): string[] => fs.readdirSync(path.join(directory, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? [name, ...files(directory, name)] : [name];
    }).sort();
  const removed = (before: string[], after: string[]) => before.filter((file) => !after.includes(file));

  it("is what rimraf resolves, and delegates to glob 14.0.3", () => {
    const resolved = packageOf(globEntry());
    expect(resolved.name).toBe("@mergeone/glob-v7-api");
    const delegate = packageOf(createRequire(path.join(resolved.directory, "index.cjs")).resolve("glob-14"));
    expect([delegate.name, delegate.version]).toEqual(["glob", "14.0.3"]);
  });

  it("detects glob characters like glob 7.2.3", () => {
    const glob = createRequire(rimrafEntry())("glob") as GlobV7;
    expect(GLOB_HAS_MAGIC.map(([pattern]) => [pattern, glob.hasMagic(pattern)])).toEqual(GLOB_HAS_MAGIC);
  });

  it("lets rimraf remove the files that glob 7.2.3 removed, sync and async", async () => {
    const rimraf = rootRequire(rimrafEntry()) as Rimraf;
    for (const [pattern, expected] of RIMRAF_REMOVED) {
      for (const mode of ["sync", "async"]) {
        const directory = fixture();
        const before = files(directory);
        try {
          if (mode === "sync") rimraf.sync(path.join(directory, pattern));
          else await new Promise<void>((resolve, reject) => rimraf(path.join(directory, pattern),
            (error) => error ? reject(error) : resolve()));
          expect([pattern, mode, removed(before, files(directory))]).toEqual([pattern, mode, expected]);
        } finally {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      }
    }
  });

  it("rejects other patterns and options, through the callback when asynchronous", async () => {
    const glob = createRequire(rimrafEntry())("glob") as GlobV7;
    const rimraf = rootRequire(rimrafEntry()) as Rimraf;
    const directory = fixture();
    const before = files(directory);
    try {
      // glob 14.0.3 expands the braces that follow ${, glob 7.2.3 does not. glob 7.2.3 finds a literal
      // portion after ** by stat, which follows the case rules of the file system; glob 14.0.3
      // compares names. Braces could hide a ** or the portion after it.
      for (const pattern of ["x[ab].txt", "+(a|b).txt", "a\\*.txt", "{a1,}.txt", "**/**/a*", "sub/**", "sub/", "./a*",
        "${x}{a1,b}.txt", "**/a4.txt", "sub/**/deep/*.txt", "sub/**/{a*,b}.txt", "{sub/**,x}/*.txt", "{*,x}*/a4.txt",
        "a?.txt", "a??.txt"]) {
        expect(() => glob.sync(directory + "/" + pattern, { nosort: true, silent: true })).toThrow(/@mergeone\/glob-v7-api/);
      }
      expect(() => glob.sync(path.join(directory, "a*"), { dot: true })).toThrow(TypeError);
      const error = await new Promise<Error | null>((resolve) => rimraf(path.join(directory, "x[ab].txt"), resolve));
      expect(error).toBeInstanceOf(TypeError);
      // A missing path that glob 7 reads as a pattern is refused, never removed as glob 14 would read it.
      for (const missing of ["a?.txt", "report[1].xlsx", "a{,}b", "a[1]"]) {
        expect(() => rimraf.sync(path.join(directory, missing))).toThrow(TypeError);
        const failure = await new Promise<Error | null>((resolve) => rimraf(path.join(directory, missing), resolve));
        expect(failure).toBeInstanceOf(TypeError);
      }
      const optionError = await new Promise<Error | null>((resolve) => glob(path.join(directory, "a*"), { nodir: true },
        (failure) => resolve(failure)));
      expect(optionError).toBeInstanceOf(TypeError);
      expect(files(directory)).toEqual(before);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
