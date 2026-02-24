import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TakeoffUploadForm } from "@/components/takeoff/TakeoffUploadForm";
import {
  createTakeoffJob,
  TakeoffApiError,
} from "@/lib/takeoff/client";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/takeoff/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/takeoff/client")>(
    "@/lib/takeoff/client"
  );

  return {
    ...actual,
    createTakeoffJob: vi.fn(),
  };
});

function makeCsvFile() {
  return new File(
    ["designation;quantity;unit\nTube PVC;12;ml"],
    "niveau-a.csv",
    { type: "text/csv" }
  );
}

describe("TakeoffUploadForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("uploads a valid file and redirects to the created job", async () => {
    const user = userEvent.setup();
    const createTakeoffJobMock = vi.mocked(createTakeoffJob);

    createTakeoffJobMock.mockImplementation(async (input) => {
      input.onUploadProgress?.(42);
      input.onUploadProgress?.(100);
      return {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "pending",
        level: "A",
        source_file_name: "niveau-a.csv",
        estimate_version_id: input.estimateVersionId,
        created_at: "2026-02-24T12:00:00.000Z",
      };
    });

    render(<TakeoffUploadForm versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />);

    const fileInput = screen.getByLabelText("Fichier takeoff");
    await user.upload(fileInput, makeCsvFile());

    expect(screen.getByText("Recap fichier")).toBeInTheDocument();
    expect(screen.getByText("niveau-a.csv")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /lancer l'extraction/i })
    );

    await waitFor(() => {
      expect(createTakeoffJobMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        "/dashboard/estimates/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/takeoff/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      );
    });
  });

  it("shows a clear server error message when API returns 413", async () => {
    const user = userEvent.setup();
    const createTakeoffJobMock = vi.mocked(createTakeoffJob);

    createTakeoffJobMock.mockRejectedValue(
      new TakeoffApiError(
        "Le fichier depasse 10 Mo.",
        413,
        null,
        "TAKEOFF_FILE_TOO_LARGE"
      )
    );

    render(<TakeoffUploadForm versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />);

    const fileInput = screen.getByLabelText("Fichier takeoff");
    await user.upload(fileInput, makeCsvFile());
    await user.click(
      screen.getByRole("button", { name: /lancer l'extraction/i })
    );

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toHaveTextContent("Le fichier depasse 10 Mo.");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("blocks unsupported file types before API call", async () => {
    const user = userEvent.setup();
    const createTakeoffJobMock = vi.mocked(createTakeoffJob);

    render(<TakeoffUploadForm versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />);

    const fileInput = screen.getByLabelText("Fichier takeoff");
    await user.upload(
      fileInput,
      new File(["hello"], "notes.txt", { type: "text/csv" })
    );

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toHaveTextContent("Extension de fichier non supportee.");

    const submitButton = screen.getByRole("button", {
      name: /lancer l'extraction/i,
    });
    expect(submitButton).toBeDisabled();
    expect(createTakeoffJobMock).not.toHaveBeenCalled();
  });

  it("reuses the same idempotency key when retrying the same file", async () => {
    const user = userEvent.setup();
    const createTakeoffJobMock = vi.mocked(createTakeoffJob);

    createTakeoffJobMock
      .mockRejectedValueOnce(
        new TakeoffApiError("Erreur reseau pendant l'envoi du fichier.", 0, null, "NETWORK_ERROR")
      )
      .mockRejectedValueOnce(
        new TakeoffApiError("Erreur reseau pendant l'envoi du fichier.", 0, null, "NETWORK_ERROR")
      );

    render(<TakeoffUploadForm versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />);

    const fileInput = screen.getByLabelText("Fichier takeoff");
    await user.upload(fileInput, makeCsvFile());

    await user.click(screen.getByRole("button", { name: /lancer l'extraction/i }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: /reessayer l'extraction/i }));

    await waitFor(() => {
      expect(createTakeoffJobMock).toHaveBeenCalledTimes(2);
    });

    const firstCallKey = createTakeoffJobMock.mock.calls[0]?.[0]?.idempotencyKey;
    const secondCallKey = createTakeoffJobMock.mock.calls[1]?.[0]?.idempotencyKey;

    expect(firstCallKey).toBeTruthy();
    expect(secondCallKey).toBe(firstCallKey);
  });
});
