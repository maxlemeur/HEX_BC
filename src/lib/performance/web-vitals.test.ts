import { describe, expect, it } from "vitest";

import {
  buildWebVitalPayload,
  describeInteractionTarget,
  INP_ATTRIBUTION_METRIC_NAME,
  sanitizeInteractionTarget,
  type InteractionTargetElement,
  type WebVitalMetricInput,
} from "@/lib/performance/web-vitals";

const ORIGIN = "https://app.example.test";

function metric(overrides: Partial<WebVitalMetricInput> = {}): WebVitalMetricInput {
  return {
    id: "v5-1700000000000-1234567890123",
    name: "INP",
    value: 412.6,
    delta: 412.6,
    rating: "poor",
    navigationType: "navigate",
    ...overrides,
  };
}

/** INP as the attribution build reports it, in its own record next to the plain INP. */
function attributedInp(overrides: Partial<WebVitalMetricInput> = {}): WebVitalMetricInput {
  return metric({ name: INP_ATTRIBUTION_METRIC_NAME, ...overrides });
}

function payloadFor(input: WebVitalMetricInput) {
  return buildWebVitalPayload({
    metric: input,
    pathname: "/dashboard/estimates/3f2a9c1e-7b4d-4e8a-9f1c-2d3e4f5a6b7c/edit",
    viewportWidth: 1280,
    buildId: "build-1",
    origin: ORIGIN,
  });
}

function element(
  tagName: string,
  attributes: Record<string, string> = {},
  parentElement: InteractionTargetElement | null = null
): InteractionTargetElement {
  return {
    tagName: tagName.toUpperCase(),
    getAttribute: (name) => attributes[name] ?? null,
    classList: (attributes.class ?? "").split(/\s+/).filter(Boolean),
    parentElement,
  };
}

describe("buildWebVitalPayload", () => {
  it("keeps the existing payload unchanged for metrics other than INP", () => {
    const payload = payloadFor(metric({ name: "LCP", value: 1800, delta: 1800, rating: "good" }));

    expect(payload).toEqual({
      id: "v5-1700000000000-1234567890123",
      name: "LCP",
      value: 1800,
      delta: 1800,
      rating: "good",
      navigationType: "navigate",
      route: "/dashboard/estimates/[id]/edit",
      viewport: "desktop",
      buildId: "build-1",
    });
  });

  it("ignores attribution attached to a metric other than INP", () => {
    const payload = payloadFor(metric({
      name: "CLS",
      value: 0.2,
      delta: 0.2,
      attribution: { inputDelay: 10, processingDuration: 20, presentationDelay: 30 },
    }));

    expect(payload).not.toHaveProperty("inp");
  });

  it("leaves INP without attribution as before", () => {
    expect(payloadFor(metric())).not.toHaveProperty("inp");
  });

  it("keeps the plain INP free of attribution, which travels in its own record", () => {
    const payload = payloadFor(metric({
      attribution: { inputDelay: 10, processingDuration: 20, presentationDelay: 30 },
    }));

    expect(payload.name).toBe("INP");
    expect(payload).not.toHaveProperty("inp");
  });

  it("names the attribution record apart from the plain INP", () => {
    const payload = payloadFor(attributedInp({
      attribution: { inputDelay: 10, processingDuration: 20, presentationDelay: 30 },
    }));

    expect(payload.name).toBe("INP-attribution");
    expect(payload.inp).toMatchObject({ inputDelay: 10, processingDuration: 20, presentationDelay: 30 });
  });

  it("maps INP subparts, the longest script and frame style/layout durations", () => {
    const payload = payloadFor(attributedInp({
      attribution: {
        interactionType: "pointer",
        interactionTarget: "main>button[data-testid=estimate-save].btn",
        inputDelay: 12.4,
        processingDuration: 301.6,
        presentationDelay: 98.6,
        totalStyleAndLayoutDuration: 61.2,
        longestScript: {
          subpart: "processing-duration",
          intersectingDuration: 250.4,
          entry: {
            invokerType: "event-listener",
            sourceURL: `${ORIGIN}/_next/static/chunks/app/estimates-3f2a9c1e-7b4d-4e8a-9f1c-2d3e4f5a6b7c.js?v=42#frag`,
            sourceFunctionName: "recomputeTotals",
            forcedStyleAndLayoutDuration: 40.2,
            forcedStyleDuration: 15.1,
            forcedLayoutDuration: 25.1,
          },
        },
        longAnimationFrameEntries: [
          { styleDuration: 10.2, layoutDuration: 20.4 },
          { styleDuration: 5.3, layoutDuration: 1.1 },
        ],
      },
    }));

    expect(payload.inp).toEqual({
      interactionType: "pointer",
      interactionTarget: "main>button[data-testid=estimate-save].btn",
      inputDelay: 12,
      processingDuration: 302,
      presentationDelay: 99,
      longestScript: {
        invokerType: "event-listener",
        sourceOrigin: "same-origin",
        sourceURL: "/_next/static/chunks/app/estimates-[id].js",
        sourceFunctionName: "recomputeTotals",
        subpart: "processing-duration",
        intersectingDuration: 250,
        forcedStyleAndLayoutDuration: 40,
        forcedStyleDuration: 15,
        forcedLayoutDuration: 25,
      },
      longAnimationFrameCount: 2,
      styleDuration: 16,
      layoutDuration: 22,
      totalStyleAndLayoutDuration: 61,
    });
    expect(payload.route).toBe("/dashboard/estimates/[id]/edit");
  });

  it("reports a cross-origin script without its URL", () => {
    const payload = payloadFor(attributedInp({
      attribution: {
        inputDelay: 200,
        processingDuration: 10,
        presentationDelay: 10,
        longestScript: {
          subpart: "input-delay",
          intersectingDuration: 180,
          entry: {
            invokerType: "classic-script",
            sourceURL: "https://cdn.vendor.example/tenant-dupont/widget.js?account=dupont",
            sourceFunctionName: "",
            forcedStyleAndLayoutDuration: 0,
          },
        },
        longAnimationFrameEntries: [{}],
      },
    }));

    expect(payload.inp?.longestScript).toMatchObject({
      sourceOrigin: "cross-origin",
      sourceURL: null,
      sourceFunctionName: null,
      forcedStyleDuration: null,
      forcedLayoutDuration: null,
    });
    expect(JSON.stringify(payload)).not.toMatch(/dupont|vendor/i);
    // A browser without separate frame style/layout timings must not report a false zero.
    expect(payload.inp?.styleDuration).toBeNull();
    expect(payload.inp?.layoutDuration).toBeNull();
  });

  it("reports only the scheme of a script URL that is not http(s)", () => {
    const payload = payloadFor(attributedInp({
      attribution: {
        inputDelay: 1,
        processingDuration: 1,
        presentationDelay: 1,
        longestScript: {
          subpart: "processing-duration",
          intersectingDuration: 1,
          entry: { invokerType: "classic-script", sourceURL: "data:text/javascript,alert('Dupont SARL')" },
        },
      },
    }));

    expect(payload.inp?.longestScript).toMatchObject({ sourceOrigin: "cross-origin", sourceURL: "data:" });
  });

  it("reports no script when the browser has no long animation frame data", () => {
    const payload = payloadFor(attributedInp({
      attribution: { inputDelay: 2, processingDuration: 3, presentationDelay: 4 },
    }));

    expect(payload.inp).toEqual({
      interactionType: null,
      interactionTarget: null,
      inputDelay: 2,
      processingDuration: 3,
      presentationDelay: 4,
      longestScript: null,
      longAnimationFrameCount: 0,
      styleDuration: null,
      layoutDuration: null,
      totalStyleAndLayoutDuration: null,
    });
  });

  it("bounds free-form script fields and rejects unknown enum values", () => {
    const payload = payloadFor(attributedInp({
      attribution: {
        interactionType: "touch-and-hold",
        inputDelay: Number.NaN,
        processingDuration: -5,
        presentationDelay: Number.POSITIVE_INFINITY,
        longestScript: {
          subpart: "everything",
          intersectingDuration: 10,
          entry: {
            invokerType: "BUTTON#client-dupont.onclick",
            sourceURL: "not a url",
            sourceFunctionName: `handle client "Dupont SARL" ${"x".repeat(500)}`,
          },
        },
        longAnimationFrameEntries: Array.from({ length: 500 }, () => ({ styleDuration: 1, layoutDuration: 1 })),
      },
    }));

    expect(payload.inp).toMatchObject({
      interactionType: null,
      inputDelay: 0,
      processingDuration: 0,
      presentationDelay: 0,
      longAnimationFrameCount: 500,
      styleDuration: 500,
      layoutDuration: 500,
    });
    expect(payload.inp?.longestScript).toMatchObject({
      invokerType: null,
      subpart: null,
      sourceOrigin: null,
      sourceURL: null,
    });
    const functionName = payload.inp?.longestScript?.sourceFunctionName ?? "";
    expect(functionName.length).toBeLessThanOrEqual(80);
    expect(functionName).not.toMatch(/[\s"]/);
    expect(JSON.stringify(payload).length).toBeLessThan(2_000);
  });

  it("sanitizes a browser-provided interaction target", () => {
    const payload = payloadFor(attributedInp({
      attribution: {
        inputDelay: 1,
        processingDuration: 1,
        presentationDelay: 1,
        interactionTarget: 'div#client-dupont>input[name="Dupont SARL"][value="12 rue des Lilas"]',
      },
    }));

    expect(payload.inp?.interactionTarget).toBe("div>input");
  });
});

describe("sanitizeInteractionTarget", () => {
  it("keeps tag names, stable classes and data-testid tokens only", () => {
    const sanitized = sanitizeInteractionTarget(
      'html>body>div#client-dupont.card>button[name="Dupont SARL"][data-testid="estimate-save"].btn.primary:hover'
    );

    expect(sanitized).toBe("div.card>button[data-testid=estimate-save].btn.primary");
    expect(sanitized).not.toMatch(/dupont|#|name|:/i);
  });

  it("drops a quoted attribute value even when it hides selector syntax", () => {
    expect(sanitizeInteractionTarget('div[title="x] .dupont > #secret"]>span.label')).toBe("div>span.label");
    expect(sanitizeInteractionTarget("div[title='a\\'] .dupont']>span")).toBe("div>span");
  });

  it("rejects a selector it cannot read exactly instead of keeping fragments", () => {
    for (const selector of [
      "img[src=https://x/a]b.dupont.png]",
      "div.foo\\.dupont",
      "div#a\\.dupont",
      'div[title="unterminated .dupont',
      "div[title=a.dupont",
      "div:is(:not(.a), .dupont",
      "button.save, a.dupont",
    ]) {
      expect(sanitizeInteractionTarget(selector), selector).toBeNull();
    }
  });

  it("drops pseudo-classes together with their arguments", () => {
    expect(sanitizeInteractionTarget("div:is(:not(.a), .dupont)>button.btn:hover")).toBe("div>button.btn");
    expect(sanitizeInteractionTarget("li:nth-child(2)::before")).toBe("li");
  });

  it("drops tokens that look like record identifiers", () => {
    expect(sanitizeInteractionTarget(
      'li[data-testid="estimate-mobile-line-00000000-0000-4000-8000-000000001000"].row-12345.Grid_row__a1B2c.px-4'
    )).toBe("li.px-4");
    expect(sanitizeInteractionTarget(
      "div[data-testid=estimate-mobile-section-3f2a9c1e-7b4d-4e8a-9f1c-2d3e4f5a6b7c]"
    )).toBe("div");
  });

  it("keeps at most two classes per element and the last four elements", () => {
    expect(sanitizeInteractionTarget("main.a.b.c>section>div>ul>li.item")).toBe("section>div>ul>li.item");
    expect(sanitizeInteractionTarget("span.one.two.three")).toBe("span.one.two");
  });

  it("caps the length while keeping the target element", () => {
    const longClass = `c${"a".repeat(38)}`;
    const selector = Array.from({ length: 8 }, () => `div.${longClass}.${longClass}`).join(">") + ">button.go";
    const sanitized = sanitizeInteractionTarget(selector) ?? "";

    expect(sanitized.length).toBeLessThanOrEqual(160);
    expect(sanitized.endsWith("button.go")).toBe(true);
  });

  it("splits on every CSS combinator and whitespace", () => {
    expect(sanitizeInteractionTarget("form .field + label ~ input")).toBe("form>.field>label>input");
  });

  it("returns null when nothing safe remains", () => {
    expect(sanitizeInteractionTarget("#client-dupont")).toBeNull();
    expect(sanitizeInteractionTarget("")).toBeNull();
    expect(sanitizeInteractionTarget(undefined)).toBeNull();
    expect(sanitizeInteractionTarget('[aria-label="Supprimer Dupont"]')).toBeNull();
  });

  it("is idempotent", () => {
    for (const selector of [
      'html>body>div#client-dupont.card>button[name="Dupont SARL"][data-testid="estimate-save"].btn.primary',
      "main.a.b.c>section>div>ul>li.item",
      "form .field + label ~ input",
    ]) {
      const once = sanitizeInteractionTarget(selector);
      expect(sanitizeInteractionTarget(once)).toBe(once);
    }
  });
});

describe("describeInteractionTarget", () => {
  it("describes the element and its ancestors without ids, attribute values or text", () => {
    const body = element("body", { class: "app" });
    const card = element("div", { id: "client-dupont", class: "card shadow-sm", title: "Dupont SARL" }, body);
    const button = element("button", { id: "save-dupont", class: "btn", "aria-label": "Enregistrer Dupont" }, card);

    const described = describeInteractionTarget(button);

    expect(described).toBe("div.card.shadow-sm>button.btn");
    expect(described).not.toMatch(/dupont|enregistrer|#|body/i);
  });

  it("stops at the nearest ancestor carrying a stable test id", () => {
    const shell = element("section", { class: "shell" });
    const toolbar = element("div", { "data-testid": "estimate-page-toolbar", class: "flex" }, shell);
    const icon = element("svg", { class: "icon" }, element("button", { class: "btn" }, toolbar));

    expect(describeInteractionTarget(icon)).toBe("div[data-testid=estimate-page-toolbar].flex>button.btn>svg.icon");
  });

  it("climbs at most four elements", () => {
    let node: InteractionTargetElement | null = null;
    for (const tag of ["main", "section", "article", "div", "ul", "li"]) node = element(tag, {}, node);

    expect(describeInteractionTarget(node!)).toBe("article>div>ul>li");
  });
});

describe("Next's vendored web-vitals attribution build", () => {
  it("still exposes onINP at the path the reporter imports", async () => {
    const attribution = await import("next/dist/compiled/web-vitals-attribution");

    expect(typeof attribution.onINP).toBe("function");
  });
});
