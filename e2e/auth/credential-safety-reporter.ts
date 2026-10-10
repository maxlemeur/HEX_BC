import type { FullResult, Reporter, TestStep } from "@playwright/test/reporter";

// These are public, synthetic fixtures. The reporter examines the actual SDK
// metadata sent to reporters, rather than inspecting the helper's source.
const fixtureSecrets = ["login-helper@example.invalid", "unused-synthetic-fixture"];

export default class CredentialSafetyReporter implements Reporter {
  private exposed = false;

  onStepEnd(_test: unknown, _result: unknown, step: TestStep) {
    const metadata = `${step.title}\n${step.error?.message ?? ""}`;
    this.exposed ||= fixtureSecrets.some((value) => metadata.includes(value));
  }

  async onEnd(): Promise<{ status: FullResult["status"] } | void> {
    if (this.exposed) {
      process.stderr.write("Login credentials appeared in Playwright report metadata.\n");
      return { status: "failed" };
    }
  }
}
