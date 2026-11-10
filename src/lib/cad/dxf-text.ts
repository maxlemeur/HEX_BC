// Text side of a DXF file: the bytes into characters (UTF-8 since AutoCAD 2007,
// the code page of the drawing before), and the formatting codes of TEXT and
// MTEXT removed so only what is written on the plan remains.

const CODE_PAGES: Record<string, string> = { "874": "windows-874", "932": "shift_jis", "936": "gbk", "949": "euc-kr", "950": "big5" };

function codePageEncoding(bytes: Uint8Array): string {
  // The header names the code page in ASCII: latin1 reads it whatever the page.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 1 << 18)));
  const match = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/i.exec(head);
  if (!match) return "windows-1252";
  return CODE_PAGES[match[1]] ?? `windows-${match[1]}`;
}

export function decodeDxf(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder(codePageEncoding(bytes)).decode(bytes);
    } catch {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }
}

/** « \U+00E9 » as written by releases without UTF-8. */
export function unescapeUnicode(value: string): string {
  if (!value.includes("\\U+") && !value.includes("\\u+")) return value;
  return value.replace(/\\[Uu]\+([0-9A-Fa-f]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function percentCodes(value: string): string {
  if (!value.includes("%%")) return value;
  return value.replace(/%%(\d{3}|.)/g, (whole, code: string) => {
    if (code.length === 3) return String.fromCharCode(Number(code));
    switch (code.toLowerCase()) {
      case "c": return "Ø";
      case "d": return "°";
      case "p": return "±";
      case "%": return "%";
      case "u": case "o": case "k": return "";
      default: return whole;
    }
  });
}

/** Content of a TEXT, ATTRIB or ATTDEF. */
export function cleanText(value: string): string {
  return percentCodes(unescapeUnicode(value)).trim();
}

/** Codes followed by a value closed by « ; ». */
const MTEXT_VALUED = "fFHWQTACcp";
const MTEXT_TOGGLES = "LlOoKk";

/** Content of an MTEXT: « \n » between its paragraphs. */
export function cleanMtext(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "{" || char === "}") continue;
    if (char === "^" && index + 1 < value.length && "IJM".includes(value[index + 1])) {
      out += value[index + 1] === "I" ? " " : value[index + 1] === "J" ? "\n" : "";
      index += 1;
      continue;
    }
    if (char !== "\\" || index + 1 >= value.length) { out += char; continue; }
    const code = value[index + 1];
    index += 1;
    if (code === "P" || code === "N" || code === "X") out += "\n";
    else if (code === "~") out += " ";
    else if (code === "\\" || code === "{" || code === "}") out += code;
    else if (MTEXT_TOGGLES.includes(code)) continue;
    else if (code === "U" && value[index + 1] === "+" && /^[0-9A-Fa-f]{4}$/.test(value.slice(index + 2, index + 6))) {
      out += String.fromCharCode(Number.parseInt(value.slice(index + 2, index + 6), 16));
      index += 5;
    } else if (code === "S" || MTEXT_VALUED.includes(code)) {
      const end = value.indexOf(";", index + 1);
      const content = value.slice(index + 1, end < 0 ? value.length : end);
      // Stacked fraction « \S1^2; » or « \S1#2; ».
      if (code === "S") out += content.replace(/\\(.)/g, "$1").replace(/\s*[\^#]\s*/g, "/");
      index = end < 0 ? value.length : end;
    } else out += code;
  }
  return percentCodes(out).split("\n").map((line) => line.trim()).join("\n").trim();
}
