// Classe les échecs Vitest : fichiers absents de l'archive vs décalage code/tests.
const fs = require("fs");
const r = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const env = [];
const other = [];
for (const f of r.testResults) {
  if (f.status === "passed") continue;
  const name = f.name.split("repository")[1].split("\\").join("/");
  const failed = f.assertionResults.filter((a) => a.status === "failed");
  const msgs = failed.map((a) => a.failureMessages.join(" ")).join(" ") + " " + (f.message || "");
  const isEnv = /ENOENT|no such file|Cannot find module/.test(msgs);
  const first = (failed[0]?.failureMessages[0] || f.message || "").split("\n")[0].slice(0, 140);
  (isEnv ? env : other).push(`${name} | ${failed.length} | ${first}`);
}
console.log(`total tests ${r.numTotalTests}, passed ${r.numPassedTests}, failed ${r.numFailedTests}, pending ${r.numPendingTests}, failed suites ${r.numFailedTestSuites}`);
console.log(`\nENV (${env.length} fichiers) :\n` + env.join("\n"));
console.log(`\nAUTRES (${other.length} fichiers) :\n` + other.join("\n"));
