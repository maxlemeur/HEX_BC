/**
 * Reprise des prix d'un devis de référence (docs/metier/reprise-des-prix.md) : rapprochement déterministe des
 * désignations. Un article n'est « identique » que si ses cotes (DN, dimensions, diamètre, épaisseur, classe de
 * pression), ses mots et son unité sont les mêmes ; une cote différente l'exclut, un mot ou une cote en moins le laisse
 * « à vérifier ». L'IA ne départage ensuite que ces cas, parmi les candidats trouvés ici.
 */

export type PriceReuseTargetLine = {
  id: string;
  title: string;
  unitCode: string | null;
  /** Titres des sections parentes, de la racine à la section de la ligne. */
  sectionPath: readonly string[];
};

export type PriceReuseReferenceLine = PriceReuseTargetLine & {
  priced: boolean;
  /** Égal pour deux lignes dont la reprise écrirait exactement les mêmes saisies de prix. */
  priceKey: string;
};

export type PriceReuseMatchStatus = "identical" | "to_review" | "new";

export type PriceReuseCandidate = {
  referenceId: string;
  exact: boolean;
  score: number;
  differences: string[];
};

export type PriceReuseMatch = {
  lineId: string;
  status: PriceReuseMatchStatus;
  proposedReferenceId: string | null;
  candidates: PriceReuseCandidate[];
  notes: string[];
};

export const PRICE_REUSE_MAX_CANDIDATES = 5;
const SIMILARITY_THRESHOLD = 0.5;

export type DimensionKind = "size" | "fraction" | "dn" | "pn" | "labeled" | "diameter" | "mm";
type PriceCharacteristic = DimensionKind | "inox_grade" | "dn_sequence" | "male_thread" | "female_thread";
const DIMENSION_LABELS: Record<PriceCharacteristic, string> = {
  size: "dimension", fraction: "fraction", dn: "DN", pn: "classe de pression", labeled: "cote repérée",
  diameter: "diamètre", mm: "cote en mm", inox_grade: "nuance inox",
  dn_sequence: "suite de DN", male_thread: "filetage mâle", female_thread: "filetage femelle",
};

const NUMBER = "(\\d+(?:\\.\\d+)?)";
// Order matters: a size « Ø22x19mm » is read before its diameter marker and its « mm ».
// Read on normalizeDimensionText output; also used by the takeoff bench (TI-660) to read a DN.
export const DIMENSION_PATTERNS: ReadonlyArray<{ kind: DimensionKind; pattern: RegExp; value: (match: string[]) => string }> = [
  { kind: "size", pattern: new RegExp(`(?:\\bo\\s*)?\\b${NUMBER}\\s*x\\s*${NUMBER}(?:\\s*mm\\b)?`, "g"),
    value: (match) => `${number(match[1])}x${number(match[2])}` },
  // Order-sensitive values: 3/4 is not 4/3, H 600 L 1000 is not H 1000 L 600.
  { kind: "fraction", pattern: /\b(\d+)\s*\/\s*(\d+)\b/g, value: (match) => `${number(match[1])}/${number(match[2])}` },
  { kind: "mm", pattern: new RegExp(`\\b(?:ep|epais|epaisseur)\\b\\.?\\s*${NUMBER}(?:\\s*mm\\b)?`, "g"),
    value: (match) => `${number(match[1])}mm` },
  { kind: "dn", pattern: new RegExp(`\\bdn\\s*-?\\s*${NUMBER}\\b`, "g"), value: (match) => `dn${number(match[1])}` },
  { kind: "pn", pattern: new RegExp(`\\bpn\\s*${NUMBER}\\b`, "g"), value: (match) => `pn${number(match[1])}` },
  { kind: "labeled", pattern: new RegExp(`\\b([hlp])\\s*=?\\s*${NUMBER}\\b`, "g"),
    value: (match) => `${match[1]}${number(match[2])}` },
  { kind: "diameter", pattern: new RegExp(`\\bo\\s*${NUMBER}\\b`, "g"), value: (match) => `o${number(match[1])}` },
  { kind: "mm", pattern: new RegExp(`\\b${NUMBER}\\s*mm\\b`, "g"), value: (match) => `${number(match[1])}mm` },
];

// Only words that never change the article. Location (sous, sur, dans), « à », « avec » and single letters (M/F,
// classe A, courbe C, 304L) do; elided articles (d', l') are removed before tokenizing.
const STOPWORDS = new Set(["au", "aux", "de", "des", "du", "en", "et", "la", "le", "les", "par", "pour", "un", "une"]);

type Signature = { dimensions: Map<PriceCharacteristic, string[]>; words: string[]; multiEndTitle: string | null; combinedGenders: boolean; empty: boolean };

function number(value: string) {
  return String(Number(value));
}

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b[dlj]['’]/g, " ")
    .replace(/[ø⌀]/g, " o ").replace(/×/g, "x")
    .replace(/\bdiam(?:etre)?\b\.?/g, " o ")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2");
}

/** The text DIMENSION_PATTERNS read: accent-free, lowercase, « Ø » as « o », decimal point, letters apart from digits. */
export const normalizeDimensionText = normalize;

function singular(word: string) {
  if (word.length <= 3 || /^\d/.test(word)) return word;
  if (word.endsWith("aux")) return word.slice(0, -1);
  return word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

function wordsOf(text: string) {
  return [...new Set(text.split(/[^a-z0-9.]+/).map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter((word) => word.length > 0 && !STOPWORDS.has(word)).map(singular))].sort();
}

// A fraction may start with whole inches (1 1/2 or 1"1/2). A standalone inch mark also identifies an integer size.
const INCHES = String.raw`(?:(?:\d+(?:\s*["″”]\s*|\s+))?\d+\s*\/\s*\d+(?:\s*["″”])?|\d+(?:[.,]\d+)?\s*["″”])`;
const GENDER = "(?:M|F|[Mm][Aa][Ll][Ee]|[Ff][Ee][Mm][Ee][Ll][Ll][Ee])";

function threadSize(raw: string) {
  const fraction = /^(?:(\d+)(?:\s*["″”]\s*|\s+))?(\d+)\s*\/\s*(\d+)/.exec(raw);
  if (!fraction) return number(raw.replace(/[\s"″”]/g, "").replace(",", ".")) + '"';
  const whole = fraction[1] ? number(fraction[1]) + " " : "";
  return whole + number(fraction[2]) + "/" + number(fraction[3]);
}

function signatureOf(title: string): Signature {
  const dimensions = new Map<PriceCharacteristic, string[]>();
  function add(kind: PriceCharacteristic, value: string) {
    const values = dimensions.get(kind);
    if (values) values.push(value);
    else dimensions.set(kind, [value]);
  }
  // Preserve M/m here: "1/2 m" can mean half a metre, while "1/2 M" labels a male end.
  let raw = title.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[¼½¾]/g, (glyph) => ({ "¼": " 1/4", "½": " 1/2", "¾": " 3/4" })[glyph]!);
  const describesVessel = /\b(?:ballons?|cuves?|reservoirs?|citernes?|chauffe[- ]eau)\b/i.test(raw);
  raw = raw.replace(/\b(inox(?:ydable)?|aisi)(?=\d)/gi, "$1 ");
  raw = raw.replace(/\b(304|316)(\s*l)?\b/gi, (match, grade: string, suffix: string | undefined, index: number) => {
    const prefix = raw.slice(0, index);
    const next = raw.slice(index + match.length);
    const followsMaterial = /\b(?:inox(?:ydable)?|aisi)\s*$/i.test(prefix);
    if (/[ø⌀]\s*$|\b(?:dn|pn|diam(?:etre)?|[hlp])\s*[.=:-]?\s*$/i.test(prefix) || /^\s*mm\b/i.test(next)) return match;
    // On a vessel, 304 L and 316 L can specify capacity; only a material prefix establishes the grade.
    if (!followsMaterial && (!suffix || describesVessel)) return match;
    // A separated "L 600" labels a length; "316 L 22x1,2" names a grade then a tube size.
    const lengthLabel = /^\s/.test(suffix ?? "") && /^\s*\d/.test(next) && !/^\s*\d+(?:[.,]\d+)?\s*[x×]\s*\d/i.test(next);
    if (lengthLabel && !followsMaterial) return match;
    add("inox_grade", grade + (suffix && !lengthLabel ? "L" : ""));
    return lengthLabel ? suffix! : " ";
  });
  // DN20x32, DN 20 × 32 and DN20 × DN32 all name the same ordered ports.
  // The first DN stays available for the index; the sequence distinguishes a different second or third port.
  raw = raw.replace(/\bdn\s*-?\s*(\d+(?:[.,]\d+)?(?:\s*[x×]\s*(?:dn\s*-?\s*)?\d+(?:[.,]\d+)?)+)(?:\s*mm)?(?![\w/"″”]|[.,]\d|\s+\d+\s*\/)/gi,
    (_match, sequence: string) => {
      const sizes = sequence.split(/\s*[x×]\s*(?:dn\s*-?\s*)?/i).map((value) => number(value.replace(",", ".")));
      add("dn", "dn" + sizes[0]);
      add("dn_sequence", sizes.join("x"));
      return " ";
    });
  // Consume labelled DN/PN before bare inches: in "DN 20 1/2 M", 20 belongs to DN.
  raw = raw.replace(/\b(dn|pn)\s*-?\s*(\d+(?:[.,]\d+)?)\b/gi, (_match, label: string, value: string) => {
    const kind = label.toLowerCase() as "dn" | "pn";
    add(kind, kind + number(value.replace(",", ".")));
    return " ";
  });
  function bindThread(rawSize: string, gender?: string) {
    const size = threadSize(rawSize);
    add("fraction", size);
    if (gender) add(gender[0].toLowerCase() === "m" ? "male_thread" : "female_thread", size);
    return " ";
  }
  // A grouped MF or F/M never says which size is male without an established notation convention.
  let combinedGenders = false;
  raw = raw.replace(/(?<![a-z])(?:m\s*[/.-]?\s*f|f\s*[/.-]?\s*m)(?![a-z])/gi, () => {
    combinedGenders = true;
    return " ";
  });
  raw = raw
    .replace(new RegExp(String.raw`\b(${INCHES})\s*(${GENDER})\b(?!\s*\/\s*[MF]\b)`, "g"),
      (_match, size: string, gender: string) => bindThread(size, gender))
    .replace(new RegExp(String.raw`\b(${GENDER})\s*(${INCHES})`, "g"),
      (_match, gender: string, size: string) => bindThread(size, gender))
    .replace(new RegExp(String.raw`\b(${INCHES})`, "g"), (_match, size: string) => bindThread(size));
  let text = normalize(raw);
  for (const { kind, pattern, value } of DIMENSION_PATTERNS) {
    text = text.replace(pattern, (...match: string[]) => {
      add(kind, value(match));
      return " ";
    });
  }
  const endCount = (dimensions.get("male_thread")?.length ?? 0) + (dimensions.get("female_thread")?.length ?? 0);
  for (const [kind, values] of dimensions) {
    const countMatters = kind === "male_thread" || kind === "female_thread";
    dimensions.set(kind, (countMatters ? values : [...new Set(values)]).sort());
  }
  const words = wordsOf(text);
  return { dimensions, words, combinedGenders, multiEndTitle: endCount > 2 ? normalize(title) : null, empty: words.length === 0 && dimensions.size === 0 };
}

function dice(left: readonly string[], right: readonly string[]) {
  if (left.length === 0 && right.length === 0) return 1;
  const rightSet = new Set(right);
  const shared = left.filter((word) => rightSet.has(word)).length;
  return (2 * shared) / (left.length + right.length);
}

function signatureKey(signature: Signature) {
  return [...signature.dimensions.entries()].sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([kind, values]) => `${kind}:${values.join(",")}`).join(";") + `|${signature.words.join(" ")}`;
}

function unitOf(code: string | null) {
  const unit = code?.trim().toLowerCase();
  return unit ? unit : null;
}

function displayDimension(value: string) {
  return value.replace(/^dn/, "DN").replace(/^pn/, "PN").replace(/^([hlp])(?=\d)/, (letter) => letter.toUpperCase())
    .replace(/^o/, "Ø").replace(/mm$/, " mm").replace(/\./g, ",");
}

type Comparison = { conflict: boolean; exact: boolean; score: number; differences: string[] };

// Leftover units, separators and numbers cannot give dimensions a service name ("DN20/32", "Ø32 mm").
const DIMENSION_WORDS = new Set(["x", "a", "mm", "cm", "m", "ml", "pouce", "dn", "pn"]);
function onlyDimensions(signature: Signature) {
  return signature.dimensions.size > 0 && signature.words.every((word) => !/[a-z]/.test(word) || DIMENSION_WORDS.has(word));
}

function compare(target: Signature, reference: Signature): Comparison {
  const differences: string[] = [];
  let conflict = false;
  let missing = 0;
  const kinds = new Set([...target.dimensions.keys(), ...reference.dimensions.keys()]);
  for (const kind of [...kinds].sort()) {
    const mine = target.dimensions.get(kind);
    const theirs = reference.dimensions.get(kind);
    if (mine && theirs) {
      if (mine.join("|") !== theirs.join("|")) conflict = true;
    } else if (theirs) {
      missing += 1;
      differences.push(`Sans ${DIMENSION_LABELS[kind]} sur la ligne (référence : ${theirs.map(displayDimension).join(", ")})`);
    } else if (mine) {
      missing += 1;
      differences.push(`Sans ${DIMENSION_LABELS[kind]} dans la référence (ligne : ${mine.map(displayDimension).join(", ")})`);
    }
  }
  const referenceWords = new Set(reference.words);
  const targetWords = new Set(target.words);
  const onlyTarget = target.words.filter((word) => !referenceWords.has(word));
  const onlyReference = reference.words.filter((word) => !targetWords.has(word));
  if (onlyReference.length > 0) differences.push(`Mots en plus dans la référence : ${onlyReference.join(", ")}`);
  if (onlyTarget.length > 0) differences.push(`Mots absents de la référence : ${onlyTarget.join(", ")}`);
  if (target.combinedGenders || reference.combinedGenders) {
    differences.push("Confirmez à quelle extrémité correspond chaque filetage mâle ou femelle.");
  }
  if (onlyDimensions(target) && onlyDimensions(reference)) {
    differences.push("Les cotes seules ne désignent pas une prestation.");
  }
  if (target.multiEndTitle && reference.multiEndTitle && target.multiEndTitle !== reference.multiEndTitle) {
    differences.push("Vérifiez la position des sorties de ce raccord.");
  }
  const similarity = dice(target.words, reference.words);
  const exact = !conflict && differences.length === 0;
  return { conflict, exact, score: exact ? 1 : Math.max(0, similarity - 0.05 * missing), differences };
}

type Ranked = PriceReuseCandidate & { index: number; section: number; priceKey: string };

function byRank(left: Ranked, right: Ranked) {
  return Number(right.exact) - Number(left.exact) || right.score - left.score || right.section - left.section ||
    left.index - right.index;
}

/** One result per target line, in the target order; deterministic for the same input. */
export function matchPriceReuseLines(input: {
  targets: readonly PriceReuseTargetLine[];
  references: readonly PriceReuseReferenceLine[];
}): PriceReuseMatch[] {
  const references = input.references.map((line, index) => ({
    line, index, signature: signatureOf(line.title), unit: unitOf(line.unitCode), section: wordsOf(normalize(line.sectionPath.join(" "))),
  })).filter((entry) => entry.line.priced && !entry.signature.empty);
  // Pre-filter by unit and DN: another unit or another DN can never be a candidate (an absent DN can).
  const byUnitAndDn = new Map<string, number[]>();
  const byUnit = new Map<string, number[]>();
  const unitsBySignature = new Map<string, Set<string>>();
  const push = (map: Map<string, number[]>, key: string, position: number) => {
    const list = map.get(key);
    if (list) list.push(position);
    else map.set(key, [position]);
  };
  references.forEach((entry, position) => {
    const signature = signatureKey(entry.signature);
    if (entry.unit) (unitsBySignature.get(signature) ?? unitsBySignature.set(signature, new Set()).get(signature)!).add(entry.unit);
    if (!entry.unit) return;
    push(byUnit, entry.unit, position);
    push(byUnitAndDn, `${entry.unit}\u0000${entry.signature.dimensions.get("dn")?.join("|") ?? ""}`, position);
  });

  return input.targets.map((target) => {
    const signature = signatureOf(target.title);
    const unit = unitOf(target.unitCode);
    if (signature.empty) return { lineId: target.id, status: "new", proposedReferenceId: null, candidates: [], notes: [] };
    const section = wordsOf(normalize(target.sectionPath.join(" ")));
    const dn = signature.dimensions.get("dn")?.join("|");
    const positions = unit === null ? [] : dn
      ? [...(byUnitAndDn.get(`${unit}\u0000${dn}`) ?? []), ...(byUnitAndDn.get(`${unit}\u0000`) ?? [])]
      : byUnit.get(unit) ?? [];
    const ranked: Ranked[] = [];
    const otherUnits = [...(unitsBySignature.get(signatureKey(signature)) ?? [])].filter((other) => other !== unit);
    for (const position of positions) {
      const reference = references[position];
      const comparison = compare(signature, reference.signature);
      if (comparison.conflict) continue;
      if (!comparison.exact && comparison.score < SIMILARITY_THRESHOLD) continue;
      ranked.push({ referenceId: reference.line.id, exact: comparison.exact, score: comparison.score,
        differences: comparison.differences, index: reference.index, section: dice(section, reference.section),
        priceKey: reference.line.priceKey });
    }
    ranked.sort(byRank);
    // The same price repeated (same designation in several sections) is one article: keep its best-placed line.
    const exactPrices = new Set<string>();
    const kept = ranked.filter((candidate) => {
      if (!candidate.exact) return true;
      if (exactPrices.has(candidate.priceKey)) return false;
      exactPrices.add(candidate.priceKey);
      return true;
    }).slice(0, PRICE_REUSE_MAX_CANDIDATES);
    const candidates = kept.map(({ referenceId, exact, score, differences }) => ({
      referenceId, exact, score: Math.round(score * 1000) / 1000, differences,
    }));
    const notes: string[] = [];
    if (candidates.length === 0) {
      if (unit === null) notes.push("Ligne sans unité : le prix ne peut pas être repris.");
      for (const other of otherUnits.sort()) notes.push(`Même désignation en ${other} dans la référence : unité à vérifier.`);
      return { lineId: target.id, status: "new", proposedReferenceId: null, candidates, notes };
    }
    if (exactPrices.size > 1) {
      notes.push("Plusieurs prix pour cet article dans la référence : choisissez la section qui correspond.");
      return { lineId: target.id, status: "to_review", proposedReferenceId: candidates[0].referenceId, candidates, notes };
    }
    return {
      lineId: target.id, status: candidates[0].exact ? "identical" : "to_review",
      proposedReferenceId: candidates[0].referenceId, candidates, notes,
    };
  });
}
