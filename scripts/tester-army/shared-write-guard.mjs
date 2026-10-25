// Writing campaigns keep the affaires they create: on an owned local stack they
// vanish with it, on a remote Supabase they accumulate. The shared base is also
// production's, so a writing run there needs a per-run acknowledgement naming
// its host, read from the shell before any .env file is loaded.
// Policy: AGENTS.md, "Runtime and workspaces". Regression: src/test/army-shared-write-guard.test.ts.
export const SHARED_WRITE_ACKNOWLEDGEMENT = "E2E_ARMY_SHARED_WRITE_HOST";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/** Throws unless the run writes nothing, targets loopback, or acknowledges exactly this remote host. */
export function assertSharedWriteAcknowledged({ hostname, writes, acknowledgement }) {
  if (!writes || isLoopbackHost(hostname)) return;
  if (acknowledgement?.trim().toLowerCase() === hostname.toLowerCase()) return;
  throw new Error(
    `This run creates affaires on ${hostname}, a remote Supabase where tests never delete their data. ` +
    "Run it on an owned local stack (npm run e2e:army:local). A check that must run there uses the designated " +
    `test account only and sets ${SHARED_WRITE_ACKNOWLEDGEMENT}=${hostname} in the shell for this run (a .env value is ignored).`
  );
}
