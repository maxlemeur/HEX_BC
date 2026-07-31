import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  it.each([
    {
      name: "prices.CSV",
      type: "application/octet-stream",
      parser: "csv",
      workerFile: "csv-parser.worker.ts",
    },
    {
      name: "prices.bin",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      parser: "xlsx",
      workerFile: "xlsx-parser.worker.ts",
    },
  ] as const)(
    "selects the $parser worker and returns its metadata",
    async ({ name, type, parser, workerFile }) => {
      const { worker, WorkerConstructor } = installWorkerStub();
      const buffer = new Uint8Array([1, 2, 3]).buffer;
      const file = createFile(name, type, buffer);
      const { result } = renderHook(() => useFileParser());

      const parsing = result.current.parseFile(file, { headerRowNumber: 4 });
      const [request, transfer] = await getPostedRequest(worker);

      expect(WorkerConstructor).toHaveBeenCalledTimes(1);
      expect(String(WorkerConstructor.mock.calls[0]?.[0])).toContain(workerFile);
      expect(request).toMatchObject({
        buffer,
        headerRowNumber: 4,
      });
      expect(transfer).toEqual([buffer]);

      worker.onmessage?.({
        data: {
          requestId: "another-request",
          ok: true,
          rows: [{ ignored: true }],
        },
      } as MessageEvent);
      expect(worker.terminate).not.toHaveBeenCalled();

      worker.onmessage?.({
        data: {
          requestId: request.requestId,
          ok: true,
          rows: [{ designation: "Tube" }],
          rowLineNumbers: [5],
          detectedEncoding: parser === "csv" ? "utf-8" : undefined,
        },
      } as MessageEvent);

      await expect(parsing).resolves.toEqual({
        mode: "worker",
        parser,
        rows: [{ designation: "Tube" }],
        rowLineNumbers: [5],
        detectedEncoding: parser === "csv" ? "utf-8" : undefined,
      });
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    }
  );

  it("rejects worker responses and runtime errors while terminating the worker", async () => {
    const { worker } = installWorkerStub();
    const { result } = renderHook(() => useFileParser());

    const parsing = result.current.parseFile(
      createFile("prices.csv", "text/csv", new ArrayBuffer(4))
    );
    const [request] = await getPostedRequest(worker);
    const rejection = expect(parsing).rejects.toThrow("CSV invalide");

    worker.onmessage?.({
      data: {
        requestId: request.requestId,
        ok: false,
        error: "CSV invalide",
      },
    } as MessageEvent);

    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    const second = installWorkerStub();
    const secondParsing = result.current.parseFile(
      createFile("prices.xlsx", "", new ArrayBuffer(4))
    );
    await getPostedRequest(second.worker);
    const secondRejection = expect(secondParsing).rejects.toThrow(
      "worker crashed"
    );

    second.worker.onerror?.({ message: "worker crashed" } as ErrorEvent);

    await secondRejection;
    expect(second.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("times out with fake timers and terminates a stalled worker", async () => {
    vi.useFakeTimers();
    const { worker } = installWorkerStub();
    const { result } = renderHook(() => useFileParser());

    const parsing = result.current.parseFile(
      createFile("prices.xls", "", new ArrayBuffer(4))
    );
    await getPostedRequest(worker);
    const rejection = expect(parsing).rejects.toThrow(
      "Le parsing local a depasse le delai autorise."
    );

    await vi.advanceTimersByTimeAsync(20_000);

    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("fails before reading the file when the environment or format is unsupported", async () => {
    const { result } = renderHook(() => useFileParser());
    vi.stubGlobal("Worker", undefined);
    const unavailableFile = createFile(
      "prices.csv",
      "text/csv",
      new ArrayBuffer(4)
    );

    await expect(result.current.parseFile(unavailableFile)).rejects.toThrow(
      "Les workers ne sont pas disponibles dans cet environnement."
    );
    expect(unavailableFile.arrayBuffer).not.toHaveBeenCalled();

    installWorkerStub();
    const unsupportedFile = createFile(
      "prices.pdf",
      "application/pdf",
      new ArrayBuffer(4)
    );

    await expect(result.current.parseFile(unsupportedFile)).rejects.toThrow(
      "Format non supporte. Utilisez un fichier CSV ou XLSX."
    );
    expect(unsupportedFile.arrayBuffer).not.toHaveBeenCalled();
  });
});
