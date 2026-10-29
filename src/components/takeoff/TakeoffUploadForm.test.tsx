vi.mock("@/app/dashboard/_actions/chatgpt", () => ({ loadChatGptConnection: vi.fn().mockResolvedValue(null) }));
import { webcrypto } from "node:crypto";
import { cleanup,render,screen,waitFor,within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import { loadChatGptConnection } from "@/app/dashboard/_actions/chatgpt";
import { TakeoffUploadForm } from "@/components/takeoff/TakeoffUploadForm";
import {
createTakeoffJob,
TakeoffApiError,
} from "@/lib/takeoff/client";

vi.mock("@/components/takeoff/TakeoffPreparationPanel", async () => {
  const { useState } = await import("react");
  return {
    TakeoffPreparationPanel: (props: import("@/components/takeoff/TakeoffPreparationPanel").TakeoffPreparationPanelProps) => {
      const [processing, setProcessing] = useState<import("@/lib/takeoff/preparation").TakeoffPreparation["processing"]>({ level: props.recommendedLevel ?? "A", provider: "auto" });
      const controls = typeof props.advancedControls === "function" ? props.advancedControls({ processing, onProcessingChange: (patch) => setProcessing((current) => ({ ...current, ...patch })), isConfirmed: false }) : props.advancedControls;
      return <><p>Préparation de {props.uploadSource?.document_name}</p><details><summary>Options avancées</summary>{controls}</details><button type="button" disabled={props.disabled || !processing.level || !props.compatibleLevels?.includes(processing.level)} onClick={() => void props.onLaunch(7, processing)}>Confirmer et lancer le métré</button></>;
    },
  };
});

Object.defineProperty(globalThis.crypto, "subtle", { value: webcrypto.subtle, configurable: true });
File.prototype.arrayBuffer = function () {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(this);
  });
};

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

function makePdfFile(name = "niveau-b.pdf") {
  return new File(["%PDF-1.7\nstub"], name, { type: "application/pdf" });
}

describe("TakeoffUploadForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps file controls inactive in server HTML until hydration can retain the selection", async () => {
    const form = <TakeoffUploadForm projectId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />;
    const container = document.createElement("div");
    container.innerHTML = renderToString(form);
    document.body.append(container);
    const before = within(container);
    expect(before.getByLabelText("Fichier source")).toBeDisabled();
    expect(before.getByRole("button", { name: /Zone de dépôt/ })).toHaveAttribute("aria-disabled", "true");
    expect(before.getByRole("button", { name: /Zone de dépôt/ })).toHaveAttribute("tabindex", "-1");
    expect(before.queryByRole("radio", { hidden: true })).not.toBeInTheDocument();

    render(form, { container, hydrate: true });
    const input = before.getByLabelText("Fichier source");
    await waitFor(() => expect(input).toBeEnabled());
    expect(before.getByRole("button", { name: /Zone de dépôt/ })).toHaveAttribute("aria-disabled", "false");
    await userEvent.setup().upload(input, makeCsvFile());
    expect(before.getByText("niveau-a.csv", { exact: true })).toBeVisible();
    expect(await before.findByRole("button", { name: /Confirmer et lancer le métré/i })).toBeEnabled();
    expect(createTakeoffJob).not.toHaveBeenCalled();
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

    render(<TakeoffUploadForm projectId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />);

    const fileInput = screen.getByLabelText("Fichier source");
    await user.upload(fileInput, makeCsvFile());
    await user.click(
      await screen.findByRole("button", { name: /Confirmer et lancer le métré/i })
    );

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toHaveTextContent("Le fichier depasse 10 Mo.");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("keeps the source-change explanation returned by the upload API", async () => {
    const message = "Les sources ont changé. Vérifiez la préparation avant de relancer.";
    vi.mocked(createTakeoffJob).mockRejectedValue(new TakeoffApiError(message, 409, null, "TAKEOFF_CONFLICT"));
    render(<TakeoffUploadForm projectId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Fichier source"), makeCsvFile());
    await user.click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("blocks unsupported file types before API call", async () => {
    const user = userEvent.setup();
    const createTakeoffJobMock = vi.mocked(createTakeoffJob);

    render(<TakeoffUploadForm projectId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />);

    const fileInput = screen.getByLabelText("Fichier source");
    await user.upload(
      fileInput,
      new File(["hello"], "notes.txt", { type: "text/csv" })
    );

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toHaveTextContent("Extension de fichier non supportee.");

    expect(screen.queryByRole("button", { name: /Confirmer et lancer le métré/i })).not.toBeInTheDocument();
    expect(createTakeoffJobMock).not.toHaveBeenCalled();
  });

  it("reports a durable queue honestly when the immediate worker trigger failed", async () => {
    const user = userEvent.setup();
    vi.mocked(createTakeoffJob).mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "pending",
      level: "A",
      source_file_name: "niveau-a.csv",
      estimate_version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      created_at: "2026-02-24T12:00:00.000Z",
      dispatch: {
        status: "queued_for_recovery",
        correlation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        persisted: true,
      },
    });

    render(
      <TakeoffUploadForm
        projectId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        onSuccess={vi.fn()}
      />
    );
    await user.upload(screen.getByLabelText("Fichier source"), makeCsvFile());
    await user.click(
      await screen.findByRole("button", { name: /Confirmer et lancer le métré/i })
    );

    expect(
      await screen.findByRole("status")
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/sera relancé automatiquement/i);
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

    render(<TakeoffUploadForm projectId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />);

    const fileInput = screen.getByLabelText("Fichier source");
    await user.upload(fileInput, makeCsvFile());

    await user.click(await screen.findByRole("button", { name: /Confirmer et lancer le métré/i }));
    await screen.findByRole("alert");

    await user.click(await screen.findByRole("button", { name: /Confirmer et lancer le métré/i }));

    await waitFor(() => {
      expect(createTakeoffJobMock).toHaveBeenCalledTimes(2);
    });

    const firstCallKey = createTakeoffJobMock.mock.calls[0]?.[0]?.idempotencyKey;
    const secondCallKey = createTakeoffJobMock.mock.calls[1]?.[0]?.idempotencyKey;

    expect(firstCallKey).toBeTruthy();
    expect(secondCallKey).toBe(firstCallKey);
  });

  it("passes the new document recommendation to preparation when a different file is selected", async () => {
    const user = userEvent.setup();

    render(
      <TakeoffUploadForm
        projectId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        allowedLevels={["B", "C"]}
      />
    );

    const fileInput = screen.getByLabelText("Fichier source");

    await user.upload(fileInput, makePdfFile("dpgf-initial.pdf"));
    await user.click(await screen.findByText("Options avancées"));
    expect(screen.getByRole("radio", { name: /niveau b/i })).toBeChecked();

    await user.upload(fileInput, makePdfFile("bordereau-second.pdf"));
    await screen.findByText("Préparation de bordereau-second.pdf");
    await user.click(await screen.findByText("Options avancées"));

    expect(screen.getByRole("radio", { name: /niveau b/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /niveau c/i })).not.toBeChecked();
  });

  it("recommends level A and blocks incompatible PDF levels for a CSV upload", async () => {
    const user = userEvent.setup();
    const createTakeoffJobMock = vi.mocked(createTakeoffJob);

    render(<TakeoffUploadForm projectId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />);

    await user.upload(
      screen.getByLabelText("Fichier source"),
      new File(["designation;quantity;unit"], "niveau-a.csv", { type: "text/csv" })
    );

    await user.click(await screen.findByText("Options avancées"));
    expect(screen.getByText("Metrage structure")).toBeInTheDocument();
    expect(screen.getByText(/Niveau recommande :/)).toBeInTheDocument();
    expect(screen.getByText("Rapide")).toBeInTheDocument();

    expect(screen.getByRole("radio", { name: /niveau a/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /niveau b/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /niveau c/i })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /Confirmer et lancer le métré/i }));

    await waitFor(() => {
      expect(createTakeoffJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "A",
          preparationRevision: 7,
          file: expect.any(File),
        })
      );
    });
  });
});

it("sends an explicit provider choice and uses a fresh idempotency key when it changes", async () => {
  vi.mocked(loadChatGptConnection).mockResolvedValueOnce({ enabled: true, selectedId: "profile", model: "plan-model", reasoningEffort: null, sharing: true, profiles: [] });
  vi.mocked(createTakeoffJob).mockRejectedValue(new Error("Temporary failure"));
  const user = userEvent.setup();
  render(<TakeoffUploadForm projectId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />);
  await user.upload(screen.getByLabelText("Fichier source"), makeCsvFile());
  await user.click(await screen.findByText("Options avancées"));
  const provider = await screen.findByLabelText("Fournisseur IA");
  await user.selectOptions(provider, "gemini");
  await user.click(await screen.findByRole("button", { name: /Confirmer et lancer le métré/i }));
  await waitFor(() => expect(createTakeoffJob).toHaveBeenCalledTimes(1));
  await user.selectOptions(provider, "chatgpt");
  await user.click(await screen.findByRole("button", { name: /Confirmer et lancer le métré/i }));
  await waitFor(() => expect(createTakeoffJob).toHaveBeenCalledTimes(2));
  const [first, second] = vi.mocked(createTakeoffJob).mock.calls.map(([input]) => input);
  expect(first.provider).toBe("gemini"); expect(second.provider).toBe("chatgpt");
  expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
});
