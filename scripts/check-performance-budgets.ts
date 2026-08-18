import { runPerformanceBudgetCheck } from "../src/test/performance-budgets";

const result = runPerformanceBudgetCheck({
  buildDirectory: process.env.PERFORMANCE_BUILD_DIR?.trim() || ".next",
});

result.measurements.forEach((measurement) => {
  console.log(
    `Performance budget passed for ${measurement.name}: ` +
      `${measurement.chunkCount} chunks, ` +
      `${measurement.gzipBytes}/${measurement.maxGzipBytes} gzip bytes.`
  );
});
