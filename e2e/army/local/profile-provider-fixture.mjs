// This dedicated profile journey never uses a subscription or a paid API.
import assert from "node:assert/strict";
import { readFile, appendFile } from "node:fs/promises";

const originalFetch = globalThis.fetch;
const knownEfforts = ["low", "medium", "high", "xhigh", "max"];
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return originalFetch(input, init);
  const control = JSON.parse(await readFile(process.env.ARMY_PROFILE_PROVIDER_CONTROL, "utf8"));
  const log = async (operation, data = {}) => appendFile(process.env.ARMY_PROFILE_PROVIDER_LOG,
    JSON.stringify({ provider: "profile-fixture", operation, ...data }) + "\n");
  if (url.href === "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk") {
    await log("framework-registry-fixture", { path: url.pathname });
    return Response.json({});
  }
  if (url.href === "https://registry.npmjs.org/-/package/next/dist-tags") {
    await log("framework-registry-fixture", { path: url.pathname });
    const { version } = JSON.parse(await readFile("node_modules/next/package.json", "utf8"));
    return Response.json({ latest: version, canary: version });
  }
  if (url.origin === "https://api.openai.com" && url.pathname === "/v1/models") {
    await log("models", { injectedFailure: control.mode === "models-error" });
    if (control.mode === "models-error") return new Response("", { status: 503 });
    return Response.json({ models: [
      { slug: "gpt-6.1-terra", display_name: "GPT-6.1 Terra", visibility: "list", supported_reasoning_levels: knownEfforts, default_reasoning_level: "medium" },
      { slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol", visibility: "list", supported_reasoning_levels: knownEfforts, default_reasoning_level: "medium" },
      { slug: "army-basic-model", display_name: "ARMY sans effort explicite", visibility: "list", supported_reasoning_levels: [] },
    ] });
  }
  if (url.origin === "https://api.openai.com" && url.pathname === "/v1/responses") {
    const body = JSON.parse(init.body);
    const userText = body.input.filter(item => item.role === "user").flatMap(item => item.content ?? [])
      .filter(item => item.type === "input_text").map(item => item.text).join("\n");
    assert.equal(userText, 'Retourne exactement {"connection":"ok"}.');
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    await log("connection", { model: body.model, reasoningEffort: body.reasoning?.effort ?? null, injectedFailure: control.mode === "connection-error" });
    if (control.mode === "connection-error") return new Response("", { status: 429 });
    return new Response(`data: ${JSON.stringify({ type: "response.completed", response: {
      status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"connection":"ok"}' }] }],
      usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
    } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
  }
  if (url.href === "https://auth.openai.com/.well-known/openid-configuration") {
    await log("discovery");
    return Response.json({ issuer: "https://auth.openai.com", revocation_endpoint: "https://auth.openai.com/army-fixture-revoke" });
  }
  if (url.href === "https://auth.openai.com/army-fixture-revoke") {
    await log("revocation", { injectedFailure: control.mode === "revocation-error" });
    return new Response("", { status: control.mode === "revocation-error" ? 503 : 200 });
  }
  await log("forbidden", { host: url.hostname, path: url.pathname });
  throw new Error("Profile journey forbids unexpected remote requests.");
};
