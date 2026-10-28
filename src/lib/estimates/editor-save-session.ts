type SaveAttempt = {
  readonly completion: Promise<void>;
  readonly resolve: () => void;
};

type SaveState = { status: "idle" } | { status: "saving"; attempt: SaveAttempt };

/** Owns the lifetime of a save, independently of React renders and network completion. */
export class EstimateEditorSaveSession {
  private state: SaveState = { status: "idle" };
  private scopeGeneration = 0;

  get generation() { return this.scopeGeneration; }
  get isSaving() { return this.state.status === "saving"; }
  get completion() { return this.state.status === "saving" ? this.state.attempt.completion : null; }

  start(): SaveAttempt {
    if (this.state.status === "saving") throw new Error("Une sauvegarde est déjà en cours.");
    let resolve!: () => void;
    const completion = new Promise<void>((done) => { resolve = done; });
    const attempt = { completion, resolve };
    this.state = { status: "saving", attempt };
    return attempt;
  }

  isCurrent(attempt: SaveAttempt) {
    return this.state.status === "saving" && this.state.attempt === attempt;
  }

  finish(attempt: SaveAttempt) {
    attempt.resolve();
    if (this.isCurrent(attempt)) this.state = { status: "idle" };
  }

  /** A previous account/version cannot acknowledge, block, or finish the next one's save. */
  reset() {
    this.scopeGeneration += 1;
    if (this.state.status === "saving") this.state.attempt.resolve();
    this.state = { status: "idle" };
  }
}
