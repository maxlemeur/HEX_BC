/**
 * HEIC photos, converted to JPEG in the browser before they are sent (TI-690).
 *
 * iPhones photograph a technician's paper in HEIC. The bucket, the server's check of what arrived and
 * most browsers read JPEG, PNG and WebP only, so the screen converts a HEIC photo to JPEG first and sends
 * that. Only the JPEG is kept: it shows what the photo showed, which is what the office needs.
 *
 * The decoder is libheif (libheif-js 1.23.5, LGPL-3.0, used unmodified from npm), about 2 MB of WebAssembly:
 * it is fetched on the first HEIC photo, in a chunk of its own, never with the page. Licence text in
 * `LICENSES/LGPL-3.0.txt`; the notices of libheif and of the codecs it bundles ship with the package
 * (`libheif-js/libheif-wasm/LICENSE`); sources at https://github.com/strukturag/libheif and
 * https://github.com/catdad-experiments/libheif-js.
 */

const HEIC_EXTENSIONS = new Set(["heic", "heif", "heics", "heifs"]);
const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
/** Close to what the phone itself writes when it exports a photo to JPEG. */
const JPEG_QUALITY = 0.9;

export class HeicConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeicConversionError";
  }
}

export function isHeicPhoto(file: File): boolean {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  return HEIC_EXTENSIONS.has(extension) || HEIC_MIME_TYPES.has(file.type.toLowerCase());
}

type HeifImage = {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(target: ImageData, done: (result: ImageData | null) => void): void;
  free(): void;
};
type HeifLibrary = {
  HeifDecoder: new () => { decoder: unknown; decode(bytes: Uint8Array): HeifImage[] };
  heif_context_free?: (context: unknown) => void;
};

let library: Promise<HeifLibrary> | null = null;

function loadLibrary(): Promise<HeifLibrary> {
  library ??= import("libheif-js/wasm-bundle").then(
    (module) => (module as { default?: HeifLibrary }).default ?? (module as unknown as HeifLibrary),
  );
  // A failed load (network, an old browser) is not kept: the next photo tries again.
  library.catch(() => {
    library = null;
  });
  return library;
}

function jpegName(name: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`;
}

function draw(image: HeifImage, target: ImageData): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    image.display(target, (result) =>
      result ? resolve(result) : reject(new HeicConversionError("The HEIC image could not be decoded.")),
    );
  });
}

function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new HeicConversionError("The JPEG could not be produced."))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

/** The photo as a JPEG, under the same name with a .jpg extension; throws HeicConversionError. */
export async function convertHeicToJpeg(file: File): Promise<File> {
  let lib: HeifLibrary;
  try {
    lib = await loadLibrary();
  } catch {
    throw new HeicConversionError("The HEIC decoder could not be loaded.");
  }

  const decoder = new lib.HeifDecoder();
  let images: HeifImage[] = [];
  try {
    images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
    // A burst or a file with a thumbnail holds several images: the primary one is the photo.
    const image = images.find((candidate) => candidate.is_primary()) ?? images[0];
    if (!image) throw new HeicConversionError("The file holds no readable image.");

    const canvas = document.createElement("canvas");
    canvas.width = image.get_width();
    canvas.height = image.get_height();
    const context = canvas.getContext("2d");
    if (!context) throw new HeicConversionError("The browser cannot draw the image.");
    // libheif applies the photo's own rotation and mirroring while decoding: the JPEG is upright.
    const pixels = await draw(image, context.createImageData(canvas.width, canvas.height));
    context.putImageData(pixels, 0, 0);
    const blob = await encode(canvas);
    return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  } catch (error) {
    if (error instanceof HeicConversionError) throw error;
    throw new HeicConversionError(error instanceof Error ? error.message : "The HEIC photo could not be converted.");
  } finally {
    for (const image of images) image.free();
    lib.heif_context_free?.(decoder.decoder);
  }
}
