import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Failure modes, written before the code (TI-690). An iPhone photographs a technician's paper in HEIC,
 * which the bucket, the server's check and most browsers do not read. The screen converts it to JPEG.
 *  1. a HEIC photo is not recognised (upper-case extension, ".heif", a MIME type and no extension) and goes
 *     out as is, to be refused; or a JPEG, PNG or WebP is converted for nothing;
 *  2. the converted photo keeps the HEIC name or type, so the server refuses it or lists « IMG.heic » as
 *     a JPEG;
 *  3. a HEIC holding several images (a burst, a thumbnail) yields the wrong one instead of the primary;
 *  4. a file that is not a readable HEIF, or a decoding failure, yields an empty or black JPEG instead of
 *     an error the operator can act on;
 *  5. the decoder's memory is never released, so a few dozen photos exhaust the tab;
 *  6. the 2 MB decoder is fetched with the page instead of on the first HEIC, or a failed load is cached
 *     for good.
 */

type FakeImage = {
  primary: boolean;
  width: number;
  height: number;
  fails?: boolean;
  freed: boolean;
};

const state = {
  images: [] as FakeImage[],
  loads: 0,
  loadFails: false,
  decoded: [] as Uint8Array[],
  contextsFreed: 0,
  painted: [] as Array<{ width: number; height: number; marker: number }>,
};

vi.mock("libheif-js/wasm-bundle", () => {
  class HeifDecoder {
    decoder = 7;
    decode(bytes: Uint8Array) {
      state.decoded.push(bytes);
      return state.images.map((image) => ({
        get_width: () => image.width,
        get_height: () => image.height,
        is_primary: () => image.primary,
        display: (target: { data: Uint8ClampedArray }, done: (result: unknown) => void) => {
          if (image.fails) return done(null);
          // Marks which image was drawn: 200 for the primary one.
          target.data[0] = image.primary ? 200 : 100;
          done(target);
        },
        free: () => {
          image.freed = true;
        },
      }));
    }
  }
  const library = { HeifDecoder, heif_context_free: () => (state.contextsFreed += 1) };
  // Each read of the export is one load of the decoder; a failed load (network, old browser) throws here.
  return {
    get default() {
      state.loads += 1;
      if (state.loadFails) throw new Error("network");
      return library;
    },
  };
});

const getContext = vi.fn();
const toBlob = vi.fn();

beforeEach(() => {
  state.images = [];
  state.loads = 0;
  state.loadFails = false;
  state.decoded = [];
  state.contextsFreed = 0;
  state.painted = [];
  getContext.mockImplementation(function (this: HTMLCanvasElement) {
    return {
      createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (data: { width: number; height: number; data: Uint8ClampedArray }) => {
        // The canvas size at drawing time, and which image was drawn.
        state.painted.push({ width: this.width, height: this.height, marker: data.data[0] });
      },
    };
  });
  toBlob.mockImplementation((callback: (blob: Blob | null) => void, type: string, quality: number) => {
    callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, Math.round(quality * 100)])], { type }));
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(getContext as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(toBlob as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const heicFile = (name = "IMG_0042.HEIC", type = "image/heic") =>
  new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])], name, { type });

describe("isHeicPhoto", () => {
  it.each([
    ["IMG_0042.HEIC", ""],
    ["photo.heic", "image/heic"],
    ["photo.heif", ""],
    ["sans-extension", "image/heif"],
    ["rafale.heics", "image/heic-sequence"],
  ])("recognises %s (%s)", async (name, type) => {
    const { isHeicPhoto } = await import("./heic-to-jpeg");
    expect(isHeicPhoto(new File(["x"], name, { type }))).toBe(true);
  });

  it.each([
    ["papier.jpg", "image/jpeg"],
    ["capture.png", "image/png"],
    ["scan.webp", "image/webp"],
    ["heic-notes.jpg", "image/jpeg"],
  ])("leaves %s alone", async (name, type) => {
    const { isHeicPhoto } = await import("./heic-to-jpeg");
    expect(isHeicPhoto(new File(["x"], name, { type }))).toBe(false);
  });
});

describe("convertHeicToJpeg", () => {
  it("turns the primary image into a JPEG named after the photo, and releases the decoder's memory", async () => {
    state.images = [
      { primary: false, width: 320, height: 240, freed: false },
      { primary: true, width: 4032, height: 3024, freed: false },
    ];
    const { convertHeicToJpeg } = await import("./heic-to-jpeg");

    const converted = await convertHeicToJpeg(heicFile());

    expect([converted.name, converted.type]).toEqual(["IMG_0042.jpg", "image/jpeg"]);
    expect(Array.from(new Uint8Array(await converted.arrayBuffer())).slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);
    expect(state.painted).toEqual([{ width: 4032, height: 3024, marker: 200 }]);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.9);
    expect(state.images.map((image) => image.freed)).toEqual([true, true]);
    expect(state.contextsFreed).toBe(1);
  });

  it("names a photo without extension", async () => {
    state.images = [{ primary: true, width: 10, height: 10, freed: false }];
    const { convertHeicToJpeg } = await import("./heic-to-jpeg");
    expect((await convertHeicToJpeg(heicFile("photo-papier", "image/heif"))).name).toBe("photo-papier.jpg");
  });

  it("refuses a file that holds no readable image, and still releases what it opened", async () => {
    state.images = [];
    const { convertHeicToJpeg, HeicConversionError } = await import("./heic-to-jpeg");
    await expect(convertHeicToJpeg(heicFile())).rejects.toBeInstanceOf(HeicConversionError);
    expect(state.painted).toEqual([]);
    expect(state.contextsFreed).toBe(1);
  });

  it("refuses a photo the decoder cannot draw, rather than an empty JPEG", async () => {
    state.images = [{ primary: true, width: 10, height: 10, fails: true, freed: false }];
    const { convertHeicToJpeg, HeicConversionError } = await import("./heic-to-jpeg");
    await expect(convertHeicToJpeg(heicFile())).rejects.toBeInstanceOf(HeicConversionError);
    expect(toBlob).not.toHaveBeenCalled();
    expect(state.images[0].freed).toBe(true);
  });

  it("refuses when the browser cannot produce the JPEG", async () => {
    state.images = [{ primary: true, width: 10, height: 10, freed: false }];
    toBlob.mockImplementation((callback: (blob: Blob | null) => void) => callback(null));
    const { convertHeicToJpeg, HeicConversionError } = await import("./heic-to-jpeg");
    await expect(convertHeicToJpeg(heicFile())).rejects.toBeInstanceOf(HeicConversionError);
  });

  it("loads the decoder only when a HEIC photo comes, once, and tries again after a failed load", async () => {
    const { convertHeicToJpeg, HeicConversionError } = await import("./heic-to-jpeg");
    expect(state.loads).toBe(0);

    state.loadFails = true;
    state.images = [{ primary: true, width: 10, height: 10, freed: false }];
    await expect(convertHeicToJpeg(heicFile())).rejects.toBeInstanceOf(HeicConversionError);

    state.loadFails = false;
    await convertHeicToJpeg(heicFile());
    await convertHeicToJpeg(heicFile());
    expect(state.decoded).toHaveLength(2);
    expect(state.loads).toBe(2);
  });
});
