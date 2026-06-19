import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";

type CliOptions = {
  refs: string[];
  inputPath: string | null;
  outputPath: string;
  credentialsPath: string;
  headed: boolean;
  baseUrl: string;
  timeoutMs: number;
};

type Credentials = {
  email: string;
  password: string;
};

type ScrapedPriceRow = {
  supplier_name: string;
  product_reference: string;
  product_designation: string;
  unit_price: string;
  currency: string;
  source_url: string;
  scraped_at: string;
  status: "ok" | "not_found" | "error";
  notes: string;
};

const DEFAULT_BASE_URL = "https://www.sofinther.fr/sof/";
const DEFAULT_CREDENTIALS_PATH = "docs/sofinther-credentials.local.md";
const DEFAULT_OUTPUT_PATH = "tmp/sofinther-prices.csv";
const SUPPLIER_NAME = "Sofinther";
const PRICE_PATTERN = /(?:^|\s)(\d{1,4}(?:[\s\u00a0\u202f.]\d{3})*(?:[,.]\d{1,2})?)\s*(?:EUR|€)/i;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    refs: [],
    inputPath: null,
    outputPath: DEFAULT_OUTPUT_PATH,
    credentialsPath: DEFAULT_CREDENTIALS_PATH,
    headed: false,
    baseUrl: DEFAULT_BASE_URL,
    timeoutMs: 30000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equalsIndex = arg.indexOf("=");
    const key = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
    const inlineValue = equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : null;
    const nextValue = () => {
      if (inlineValue !== null) return inlineValue;
      index += 1;
      return argv[index] ?? "";
    };

    switch (key) {
      case "--refs":
        options.refs.push(...splitRefs(nextValue()));
        break;
      case "--input":
        options.inputPath = nextValue();
        break;
      case "--output":
        options.outputPath = nextValue();
        break;
      case "--credentials":
        options.credentialsPath = nextValue();
        break;
      case "--base-url":
        options.baseUrl = nextValue();
        break;
      case "--timeout-ms":
        options.timeoutMs = Number.parseInt(nextValue(), 10);
        break;
      case "--headed":
        options.headed = true;
        break;
      default:
        if (arg.trim()) options.refs.push(...splitRefs(arg));
        break;
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 5000) {
    options.timeoutMs = 30000;
  }

  return options;
}

function splitRefs(value: string): string[] {
  return value
    .split(/[,\n;\t]/)
    .map((ref) => ref.trim())
    .filter(Boolean);
}

async function readRefs(options: CliOptions): Promise<string[]> {
  const refs = [...options.refs];

  if (options.inputPath) {
    const input = await readFile(options.inputPath, "utf8");
    refs.push(...splitRefs(input));
  }

  return Array.from(new Set(refs));
}

function readSecretFromText(text: string, key: string): string {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "im"));
  return match?.[1]?.trim() ?? "";
}

async function readCredentials(credentialsPath: string): Promise<Credentials> {
  const emailFromEnv = process.env.SOFINTHER_EMAIL?.trim() ?? "";
  const passwordFromEnv = process.env.SOFINTHER_PASSWORD?.trim() ?? "";

  if (emailFromEnv && passwordFromEnv) {
    return {
      email: emailFromEnv,
      password: passwordFromEnv,
    };
  }

  const content = await readFile(credentialsPath, "utf8");
  const email = emailFromEnv || readSecretFromText(content, "SOFINTHER_EMAIL");
  const password = passwordFromEnv || readSecretFromText(content, "SOFINTHER_PASSWORD");

  if (!email || !password) {
    throw new Error(
      `Identifiants Sofinther incomplets. Verifier ${credentialsPath} ou SOFINTHER_EMAIL/SOFINTHER_PASSWORD.`
    );
  }

  return { email, password };
}

async function clickFirstVisible(locators: Locator[], timeoutMs = 2500): Promise<boolean> {
  for (const locator of locators) {
    const first = locator.first();
    try {
      await first.waitFor({ state: "visible", timeout: timeoutMs });
      await first.click();
      return true;
    } catch {
      // Try the next locator.
    }
  }

  return false;
}

async function fillFirstVisible(
  locators: Locator[],
  value: string,
  timeoutMs = 2500
): Promise<boolean> {
  for (const locator of locators) {
    const first = locator.first();
    try {
      await first.waitFor({ state: "visible", timeout: timeoutMs });
      await first.fill(value);
      return true;
    } catch {
      // Try the next locator.
    }
  }

  return false;
}

async function login(page: Page, options: CliOptions, credentials: Credentials) {
  await page.goto(options.baseUrl, {
    waitUntil: "domcontentloaded",
    timeout: options.timeoutMs,
  });
  await page.waitForLoadState("networkidle", { timeout: options.timeoutMs }).catch(() => undefined);

  await clickFirstVisible([
    page.getByRole("button", { name: /accepter|accept/i }),
    page.getByRole("button", { name: /tout accepter/i }),
  ], 1000);

  const openedLogin = await clickFirstVisible([
    page.getByRole("link", { name: /connexion|login|compte/i }),
    page.getByRole("button", { name: /connexion|login|compte/i }),
    page.locator("a[href*='login'], a[href*='connexion'], button:has-text('Connexion')"),
  ]);

  if (!openedLogin) {
    const alreadyLoggedIn = await page.getByText(/deconnexion|mon compte|mes commandes/i).first().isVisible()
      .catch(() => false);
    if (alreadyLoggedIn) return;
  }

  const emailFilled = await fillFirstVisible([
    page.getByLabel(/e-?mail|identifiant|login/i),
    page.getByPlaceholder(/e-?mail|identifiant|login/i),
    page.locator("input[type='email']"),
    page.locator("input[name*='email' i], input[name*='login' i], input[id*='email' i], input[id*='login' i]"),
  ], credentials.email);

  const passwordFilled = await fillFirstVisible([
    page.getByLabel(/mot de passe|password/i),
    page.getByPlaceholder(/mot de passe|password/i),
    page.locator("input[type='password']"),
    page.locator("input[name*='password' i], input[id*='password' i]"),
  ], credentials.password);

  if (!emailFilled || !passwordFilled) {
    throw new Error("Impossible de trouver les champs email/mot de passe Sofinther.");
  }

  await clickFirstVisible([
    page.getByRole("button", { name: /^connexion$/i }),
    page.getByRole("button", { name: /se connecter|login|connexion/i }),
    page.locator("button[type='submit'], input[type='submit']"),
  ]);

  await page.waitForLoadState("networkidle", { timeout: options.timeoutMs }).catch(() => undefined);
}

function normalizePrice(value: string): string {
  const stripped = value
    .replace(/EUR|€/gi, "")
    .replace(/\s|\u00a0|\u202f/g, "")
    .trim();
  const normalized = stripped.includes(",") ? stripped.replace(/\./g, "").replace(",", ".") : stripped;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "";
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function toCsv(rows: ScrapedPriceRow[]): string {
  const headers: Array<keyof ScrapedPriceRow> = [
    "supplier_name",
    "product_reference",
    "product_designation",
    "unit_price",
    "currency",
    "source_url",
    "scraped_at",
    "status",
    "notes",
  ];

  return [
    headers.join(";"),
    ...rows.map((row) => headers.map((header) => csvEscape(String(row[header]))).join(";")),
  ].join("\n");
}

async function extractBestResult(page: Page, reference: string): Promise<{
  designation: string;
  price: string;
  sourceUrl: string;
  notes: string;
} | null> {
  const result = await page.evaluate((inputReference) => {
    const pricePattern = /(?:^|\s)(\d{1,4}(?:[\s\u00a0\u202f.]\d{3})*(?:[,.]\d{1,2})?)\s*(?:EUR|€)/i;
    const selectors = [
      "article",
      "[data-testid*='product' i]",
      "[class*='product' i]",
      "[class*='article' i]",
      "mf-product-card",
      "mf-product-list-item",
      "li",
    ];
    const seen = new Set<Element>();
    const candidates: Array<{
      text: string;
      href: string;
      score: number;
      priceText: string;
    }> = [];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (seen.has(element)) return;
        seen.add(element);
        const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (!text || !pricePattern.test(text)) return;
        const anchor = element.querySelector<HTMLAnchorElement>("a[href]");
        const href = anchor?.href ?? location.href;
        const lowerText = text.toLowerCase();
        const lowerReference = inputReference.toLowerCase();
        const score = (lowerText.includes(lowerReference) ? 100 : 0) + Math.min(text.length, 500);
        const priceText = text.match(pricePattern)?.[0] ?? "";
        candidates.push({ text, href, score, priceText });
      });
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0] ?? null;
  }, reference);

  if (!result) return null;

  return {
    designation: compactText(result.text).slice(0, 240),
    price: normalizePrice(result.priceText),
    sourceUrl: result.href,
    notes: compactText(result.text).slice(0, 500),
  };
}

async function scrapeReference(
  page: Page,
  options: CliOptions,
  reference: string
): Promise<ScrapedPriceRow> {
  const now = new Date().toISOString();
  const searchUrl = new URL("search", options.baseUrl);
  searchUrl.searchParams.set("text", reference);

  try {
    await page.goto(searchUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });
    await page.waitForLoadState("networkidle", { timeout: options.timeoutMs }).catch(() => undefined);
    await page.waitForTimeout(1000);

    const result = await extractBestResult(page, reference);

    if (!result?.price) {
      return {
        supplier_name: SUPPLIER_NAME,
        product_reference: reference,
        product_designation: reference,
        unit_price: "",
        currency: "EUR",
        source_url: page.url(),
        scraped_at: now,
        status: "not_found",
        notes: "Aucun prix detecte sur la page de recherche.",
      };
    }

    return {
      supplier_name: SUPPLIER_NAME,
      product_reference: reference,
      product_designation: result.designation || reference,
      unit_price: result.price,
      currency: "EUR",
      source_url: result.sourceUrl,
      scraped_at: now,
      status: "ok",
      notes: result.notes,
    };
  } catch (error) {
    return {
      supplier_name: SUPPLIER_NAME,
      product_reference: reference,
      product_designation: reference,
      unit_price: "",
      currency: "EUR",
      source_url: page.url(),
      scraped_at: now,
      status: "error",
      notes: error instanceof Error ? error.message : "Erreur inconnue.",
    };
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const refs = await readRefs(options);

  if (refs.length === 0) {
    throw new Error("Aucune reference fournie. Utiliser --refs ou --input.");
  }

  const credentials = await readCredentials(options.credentialsPath);
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: !options.headed });
    const context = await browser.newContext({
      locale: "fr-FR",
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);

    await login(page, options, credentials);

    const rows: ScrapedPriceRow[] = [];
    for (const reference of refs) {
      console.log(`Recherche Sofinther: ${reference}`);
      rows.push(await scrapeReference(page, options, reference));
    }

    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${toCsv(rows)}\n`, "utf8");

    const okCount = rows.filter((row) => row.status === "ok").length;
    console.log(`CSV Sofinther ecrit: ${options.outputPath}`);
    console.log(`Prix trouves: ${okCount}/${rows.length}`);
  } finally {
    await browser?.close();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
