import { renderHook } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";

import { useFileParser } from "@/hooks/useFileParser";

type WorkerRequest = {
  requestId: string;
  buffer: ArrayBuffer;
  headerRowNumber: number | null;
};

type WorkerStub = {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
};

function installWorkerStub() {
  const worker: WorkerStub = {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  const WorkerConstructor = vi.fn<
    (scriptUrl: URL, options?: WorkerOptions) => WorkerStub
  >(function WorkerConstructor() {
    return worker;
  });

  vi.stubGlobal("Worker", WorkerConstructor);

  return { worker, WorkerConstructor };
}

function createFile(name: string, type: string, buffer: ArrayBuffer) {
  const file = new File(["fixture"], name, { type });
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: vi.fn().mockResolvedValue(buffer),
  });
  return file;
}

async function getPostedRequest(worker: WorkerStub) {
  await Promise.resolve();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  return worker.postMessage.mock.calls[0] as [WorkerRequest, ArrayBuffer[]];
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useFileParser", () => {
  it("times out with fake timers and terminates a stalled worker", async () => {
    vi.useFakeTimers();
    const { worker } = installWorkerStub();
    const { result } = renderHook(() => useFileParser());

    const parsing = result.current.parseFile(
      createFile("prices.xls", "", new ArrayBuffer(4))
    );
    await getPostedRequest(worker);
    const rejection = expect(parsing).rejects.toThrow(
      "L'analyse locale du fichier a dépassé le délai autorisé."
    );

    await vi.advanceTimersByTimeAsync(20_000);

    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
