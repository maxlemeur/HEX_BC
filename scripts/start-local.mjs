import { parseArgs } from "node:util";

import { startDevServer } from "./dev-chatgpt-local.mjs";

try {
  const { values } = parseArgs({
    options: {
      port: { type: "string", short: "p", multiple: true },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`Usage: npm run start -- [--port <port>]
  3000–3009  Local Supabase (default: 3000)
  4200–4209  Production Supabase with the signed-in account's permissions
  -p and the PORT environment variable also set the port.
  Use npm run start:local for 3001 or npm run start:prod for 4200.
  Use npm run start:build to serve an existing Next.js build.`);
  } else {
    const [portOption, repeatedPort] = values.port ?? [];
    if (repeatedPort !== undefined) throw new Error("Pass the port once. Use npm run start to select another port.");
    const port = portOption ?? process.env.PORT ?? "3000";
    const productionPort = /^420[0-9]$/.test(port);
    if (!productionPort && !/^300[0-9]$/.test(port)) {
      throw new Error("Choose a port in 3000–3009 for local Supabase or 4200–4209 for production Supabase.");
    }
    const mode = productionPort ? "production" : "local";

    // An explicit port prevents Next from retrying on the next port if it is busy.
    await startDevServer({ args: [`--supabase=${mode}`, "--port", port] });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
