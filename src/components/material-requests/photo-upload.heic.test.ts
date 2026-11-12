import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Failure modes, written before the code (TI-690): HEIC photos in the upload of an original.
 *  1. a HEIC photo reaches the server as HEIC and is refused, although the screen can convert it;
 *  2. the server is told the HEIC name, size or type while storage receives the JPEG, so the check of what
 *     arrived (size, first bytes) rejects the batch;
 *  3. a photo that cannot be converted is sent anyway, or makes the whole screen fail without saying which
 *     photo and what to do; or the other photos of the batch are sent without it, contrary to the
 *     all-or-nothing rule of a batch;
 *  4. JPEG, PNG and WebP photos are converted for nothing;
 *  5. the operator sees nothing while a large photo converts, or leaving during the conversion still
 *     prepares and sends the batch.
 */

const { prepareMock, completeMock, discardMock, uploadMock, convertMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  completeMock: vi.fn(),
  discardMock: vi.fn(),
  uploadMock: vi.fn(),
  convertMock: vi.fn(),
}));

vi.mock("@/lib/material-requests/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/material-requests/client")>()),
  prepareMaterialRequestFiles: prepareMock,
  completeMaterialRequestFiles: completeMock,
  discardPreparedMaterialRequestFile: discardMock,
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: uploadMock }) } }),
}));

vi.mock("./heic-to-jpeg", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./heic-to-jpeg")>()),
  convertHeicToJpeg: convertMock,
}));

import { HeicConversionError } from "./heic-to-jpeg";
import { photoUploadStepLabel, uploadMaterialRequestPhotos, type PhotoUploadStep } from "./photo-upload";

const jpegOf = (name: string, size: number) =>
  new File([new Uint8Array(size).fill(0xff)], name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });

beforeEach(() => {
  for (const mock of [prepareMock, completeMock, discardMock, uploadMock, convertMock]) mock.mockReset();
  prepareMock.mockImplementation(async (_projectId: string, _requestId: string, input: { files: Array<{ name: string; mime_type: string; byte_size: number }> }) => ({
    uploads: input.files.map((file, index) => ({
      file: { id: `file-${index}`, file_name: file.name, mime_type: file.mime_type || "image/jpeg", byte_size: file.byte_size },
      path: `p/${index}`,
      token: `t${index}`,
    })),
  }));
  uploadMock.mockResolvedValue({ error: null });
  completeMock.mockImplementation(async (_p: string, _r: string, input: { ids: string[] }) =>
    input.ids.map((id) => ({ id })),
  );
  discardMock.mockResolvedValue(undefined);
  convertMock.mockImplementation(async (file: File) => jpegOf(file.name, 300));
});

const upload = (files: File[], signal?: AbortSignal) => {
  const steps: PhotoUploadStep[] = [];
  return {
    steps,
    result: uploadMaterialRequestPhotos({ projectId: "p", requestId: "r", files, onStep: (step) => steps.push(step), signal }),
  };
};

describe("HEIC photos in an upload", () => {
  it("converts a HEIC photo first and announces and sends the JPEG, name, size and type included", async () => {
    const heic = new File([new Uint8Array(2_000)], "IMG_0042.HEIC", { type: "image/heic" });
    const paper = new File([new Uint8Array(500)], "papier.png", { type: "image/png" });
    const { result, steps } = upload([paper, heic]);

    expect(await result).toEqual({ ok: true, files: [{ id: "file-0" }, { id: "file-1" }] });
    expect(convertMock).toHaveBeenCalledTimes(1);
    expect(convertMock).toHaveBeenCalledWith(heic);
    expect(prepareMock.mock.calls[0][2]).toEqual({
      files: [
        { name: "papier.png", mime_type: "image/png", byte_size: 500 },
        { name: "IMG_0042.jpg", mime_type: "image/jpeg", byte_size: 300 },
      ],
    });
    const sent = uploadMock.mock.calls.map(([path, , body, options]) => [path, (body as File).name, (body as File).size, options]);
    expect(sent).toEqual([
      ["p/0", "papier.png", 500, { contentType: "image/png" }],
      ["p/1", "IMG_0042.jpg", 300, { contentType: "image/jpeg" }],
    ]);
    expect(steps[0]).toEqual({ step: "converting", index: 1, total: 1, fileName: "IMG_0042.HEIC" });
    expect(photoUploadStepLabel(steps[0])).toBe("Conversion en JPEG de la photo IMG_0042.HEIC…");
  });

  it("numbers the conversions when several HEIC photos come together", () => {
    expect(photoUploadStepLabel({ step: "converting", index: 2, total: 3, fileName: "IMG_7.heic" })).toBe(
      "Conversion en JPEG de la photo 2 sur 3 : IMG_7.heic…",
    );
  });

  it("sends nothing of the batch when one photo cannot be converted, and says which one and what to do", async () => {
    convertMock.mockRejectedValueOnce(new HeicConversionError("decode"));
    const { result } = upload([
      new File(["x"], "abime.heic", { type: "image/heic" }),
      new File(["y"], "papier.jpg", { type: "image/jpeg" }),
    ]);

    expect(await result).toEqual({
      ok: false,
      message:
        "« abime.heic » n’a pas pu être convertie en JPEG. Aucune photo n’a été gardée : enregistrez-la en JPEG sur le téléphone, puis déposez-la à nouveau.",
    });
    expect(prepareMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("does not convert JPEG, PNG or WebP photos", async () => {
    const { result } = upload([
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.png", { type: "image/png" }),
      new File(["c"], "c.webp", { type: "image/webp" }),
    ]);
    expect((await result).ok).toBe(true);
    expect(convertMock).not.toHaveBeenCalled();
  });

  it("prepares and sends nothing when the operator leaves during a conversion", async () => {
    const leaving = new AbortController();
    convertMock.mockImplementation(async (file: File) => {
      leaving.abort();
      return jpegOf(file.name, 300);
    });
    const { result } = upload([new File(["x"], "IMG_1.heic", { type: "image/heic" })], leaving.signal);

    expect(await result).toEqual({ ok: false, abandoned: true, message: "Envoi interrompu. Aucune photo n’a été gardée." });
    expect(prepareMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
