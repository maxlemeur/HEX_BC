// libheif-js ships no declaration for its browser bundle; heic-to-jpeg.ts types the part it uses.
declare module "libheif-js/wasm-bundle" {
  const libheif: unknown;
  export default libheif;
}
