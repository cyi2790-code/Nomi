/**
 * Tests for schema-first parameter extraction. The motivating real case is the
 * kie.ai GPT Image-2 doc: an Apidog SPA with NO <table> and NO curl, where the
 * full contract (16 aspect ratios, 1K/2K/4K resolution, nested `input` object)
 * lives only in embedded spec data. The curl-blueprint path captured almost
 * nothing; these two extractors are the root fix.
 */
import { describe, it, expect } from "vitest";
import { extractOpenApiOperations, extractDehydratedParameters, extractEmbeddedParameterData, extractSpecLinks } from "./specExtractors";

describe("extractOpenApiOperations — deterministic OpenAPI parse", () => {
  // Mirrors kie's shape: top-level model/callBackUrl/input, input is a $ref'd
  // object whose properties carry the real enums + defaults.
  const spec = {
    openapi: "3.0.1",
    paths: {
      "/api/v1/jobs/createTask": {
        post: {
          summary: "Create GPT Image-2 task",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["model", "input"],
                  properties: {
                    model: { type: "string", default: "gpt-image-2-text-to-image" },
                    callBackUrl: { type: "string" },
                    input: { $ref: "#/components/schemas/Input" },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Input: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: { type: "string", description: "The text prompt to generate from." },
            aspect_ratio: {
              type: "string",
              default: "auto",
              enum: ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"],
            },
            resolution: { type: "string", enum: ["1K", "2K", "4K"] },
          },
        },
      },
    },
  };
  const html = `<html><body><script type="application/json">${JSON.stringify(spec)}</script></body></html>`;

  it("finds the createTask operation", () => {
    const ops = extractOpenApiOperations(html);
    expect(ops.length).toBe(1);
    expect(ops[0].method).toBe("POST");
    expect(ops[0].path).toBe("/api/v1/jobs/createTask");
  });

  it("extracts nested input.* params and skips the wired `model` key", () => {
    const ops = extractOpenApiOperations(html);
    const keys = ops[0].fields.map((f) => f.key);
    expect(keys).toContain("prompt");
    expect(keys).toContain("aspect_ratio");
    expect(keys).toContain("resolution");
    expect(keys).not.toContain("model"); // server-side wiring
  });

  it("captures the FULL enum option set, not a single value", () => {
    const ops = extractOpenApiOperations(html);
    const ar = ops[0].fields.find((f) => f.key === "aspect_ratio")!;
    expect(ar.type).toBe("select");
    expect(ar.options!.map((o) => o.value)).toEqual([
      "auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21",
    ]);
    expect(ar.default).toBe("auto");
    const res = ops[0].fields.find((f) => f.key === "resolution")!;
    expect(res.options!.map((o) => o.value)).toEqual(["1K", "2K", "4K"]);
  });

  it("attaches >=20-char evidence with an OpenAPI location to every field", () => {
    const ops = extractOpenApiOperations(html);
    for (const f of ops[0].fields) {
      expect(f.evidence.evidence.length).toBeGreaterThanOrEqual(20);
      expect(f.evidence.evidence_location).toContain("OpenAPI");
    }
  });

  it("returns [] when no parseable spec is embedded", () => {
    expect(extractOpenApiOperations("<html><body><p>no spec here</p></body></html>")).toEqual([]);
  });

  it("parses an inline (non-script-tag) openapi object via balanced scan", () => {
    const inline = `window.__DATA = {"openapi":"3.0.0","paths":${JSON.stringify(spec.paths)},"components":${JSON.stringify(spec.components)}};`;
    const ops = extractOpenApiOperations(inline);
    expect(ops.length).toBe(1);
    expect(ops[0].fields.map((f) => f.key)).toContain("aspect_ratio");
  });

  it("drops Replicate envelope/output-wiring keys (context, output_file_prefix)", () => {
    // Real Replicate /predictions schema mixes generation params with platform
    // wiring: `context` (nullable object) and `output_file_prefix` ride on every
    // model regardless of generation semantics — they must not become node params.
    const repl = {
      openapi: "3.0.0",
      paths: {
        "/predictions": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      prompt: { type: "string" },
                      aspect_ratio: { type: "string", enum: ["1:1", "16:9"] },
                      context: { type: "object", nullable: true },
                      output_file_prefix: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const html = `<script type="application/json">${JSON.stringify(repl)}</script>`;
    const keys = extractOpenApiOperations(html)[0].fields.map((f) => f.key);
    expect(keys).toContain("prompt");
    expect(keys).toContain("aspect_ratio");
    expect(keys).not.toContain("context");
    expect(keys).not.toContain("output_file_prefix");
  });

  it("dedupes the same method+path emitted twice, keeping the richer op", () => {
    // A page can embed the same spec twice (Replicate: <script> + inline), each
    // slightly different. We must not surface two ops for one path.
    const mk = (props: Record<string, unknown>) => ({
      openapi: "3.0.0",
      paths: { "/predictions": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: props } } } } } } },
    });
    const lean = mk({ prompt: { type: "string" } });
    const rich = mk({ prompt: { type: "string" }, aspect_ratio: { type: "string", enum: ["1:1", "16:9"] } });
    const html = `<script type="application/json">${JSON.stringify(lean)}</script><script type="application/json">${JSON.stringify(rich)}</script>`;
    const ops = extractOpenApiOperations(html);
    expect(ops.length).toBe(1);
    expect(ops[0].fields.map((f) => f.key)).toContain("aspect_ratio"); // kept the richer
  });
});

describe("extractSpecLinks — lazy-loaded spec discovery (R2)", () => {
  it("finds the fal.ai relative openapi.json URL and resolves it absolute", () => {
    // fal.ai's Next/RSC shell references the spec, doesn't embed it.
    const html = `<script>self.__next_f.push([1,"...\\"specUrl\\":\\"/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux-pro\\"..."])</script>`;
    const links = extractSpecLinks(html, "https://fal.ai/models/fal-ai/flux-pro");
    expect(links).toContain("https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux-pro");
  });

  it("finds an absolute swagger.json URL", () => {
    const html = `<link rel="alternate" href="https://api.example.com/v1/swagger.json">`;
    const links = extractSpecLinks(html, "https://docs.example.com/page");
    expect(links).toContain("https://api.example.com/v1/swagger.json");
  });

  it("resolves a root-relative openapi spec against the page origin", () => {
    const html = `<redoc spec-url="/static/openapi.json"></redoc>`;
    const links = extractSpecLinks(html, "https://docs.example.com/reference/intro");
    expect(links).toContain("https://docs.example.com/static/openapi.json");
  });

  it("dedupes repeated references and caps the result", () => {
    const html = `"/openapi.json" "/openapi.json" "/openapi.json"`;
    const links = extractSpecLinks(html, "https://x.com/a");
    expect(links).toEqual(["https://x.com/openapi.json"]);
  });

  it("ignores generic .json assets and bare prose mentions", () => {
    const html = `<p>Our OpenAPI support is great.</p><script src="/config/locale.json"></script>`;
    expect(extractSpecLinks(html, "https://x.com/a")).toEqual([]);
  });

  it("returns [] when the page already embeds nothing spec-like", () => {
    expect(extractSpecLinks("<html><body>no spec</body></html>", "https://x.com/a")).toEqual([]);
  });
});

describe("extractDehydratedParameters — structured Apidog-store recovery", () => {
  // Mirrors the real kie.ai GPT Image-2 dehydrated store: a clean
  // "method","post","path","..." run, two real enum params each preceded by a
  // numeric ref array (the dereferenced-label signature), plus CSS/nav noise
  // runs that must be rejected. Strings are JSON-in-JSON escaped as on the page.
  const html =
    "<script>self.__d=[" +
    // operation method/path
    '"apiDetail.1","method","post","path","/api/v1/jobs/createTask","status",' +
    // NOISE: a CSS background-size run preceded by `},` (no ref array) — reject
    '{"_5":1857},"size","cover","scale",' +
    // NOISE: locale switcher preceded by a string — reject
    '"folder","01KJH","\\uD83C\\uDDFA\\uD83C\\uDDF8 English","selected","to",' +
    // REAL: aspect_ratio — descriptor obj, description, ref array, then values
    '"aspect_ratio",{"_5":2016,"_23":2048},' +
    '"The aspect ratio of the generated image is set to auto by default.",' +
    "[2050,2051,2052,2053,2054,2055,2056,2057,2058,2059,2060,2061,2062,2063,2064,2065]," +
    '"auto","1:1","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","2:1","1:2","3:1","1:3","21:9","9:21",' +
    "[2067,2068]," +
    // REAL: resolution — descriptor obj, ref array, then values
    '"resolution",{"_5":2016,"_23":2094},[2087,2088,2089],"1K","2K","4K",[2091,2092]' +
    "];</script>";

  it("recovers the method and path from the embedded operation", () => {
    const ops = extractDehydratedParameters(html);
    expect(ops.length).toBe(1);
    expect(ops[0].method).toBe("POST");
    expect(ops[0].path).toBe("/api/v1/jobs/createTask");
  });

  it("captures both real enum params with their FULL option sets", () => {
    const ops = extractDehydratedParameters(html);
    const keys = ops[0].fields.map((f) => f.key).sort();
    expect(keys).toEqual(["aspect_ratio", "resolution"]);
    const ar = ops[0].fields.find((f) => f.key === "aspect_ratio")!;
    expect(ar.type).toBe("select");
    expect(ar.options!.map((o) => o.value)).toEqual([
      "auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21",
    ]);
    expect(ar.default).toBe("auto"); // parsed from "...set to auto by default."
    const res = ops[0].fields.find((f) => f.key === "resolution")!;
    expect(res.options!.map((o) => o.value)).toEqual(["1K", "2K", "4K"]);
  });

  it("rejects CSS / navigation noise runs (no ref-array signature)", () => {
    const ops = extractDehydratedParameters(html);
    const keys = ops[0].fields.map((f) => f.key);
    expect(keys).not.toContain("size");
    expect(keys).not.toContain("language");
    expect(keys).not.toContain("width");
    expect(keys).not.toContain("style");
  });

  it("attaches >=20-char evidence with a dehydrated-spec location", () => {
    const ops = extractDehydratedParameters(html);
    for (const f of ops[0].fields) {
      expect(f.evidence.evidence.length).toBeGreaterThanOrEqual(20);
      expect(f.evidence.evidence_location).toContain("dehydrated");
    }
  });

  it("returns [] when no generation-param enum runs are present", () => {
    expect(extractDehydratedParameters('<script>self.x=["a","b","c"]</script>')).toEqual([]);
  });

  it("caps options to the ref-array length and drops leaked x-apidog-enum keys", () => {
    // Real grok-imagine shape: ref array has 2 entries → 2 real values, but
    // Apidog's "x-apidog-enum" extension key sits adjacent in the token run.
    const html =
      "<script>self.__d=[" +
      '"resolution",{"_5":2016},"The resolution of the generated video.",' +
      '[2053,2054],"480p","720p","x-apidog-enum",[2057,2059],{"_2058":2053}' +
      "];</script>";
    const ops = extractDehydratedParameters(html);
    const res = ops[0].fields.find((f) => f.key === "resolution")!;
    expect(res.options!.map((o) => o.value)).toEqual(["480p", "720p"]);
  });
});

describe("extractEmbeddedParameterData — dehydrated SPA store digest", () => {
  it("recovers JSON-in-JSON escaped enum arrays (Apidog form)", () => {
    // Apidog stores enum strings escaped inside an outer JSON string.
    const html =
      '<script>self.__store=["aspect_ratio",' +
      '"\\"auto\\",\\"1:1\\",\\"3:2\\",\\"2:3\\",\\"4:3\\",\\"3:4\\",\\"5:4\\",\\"4:5\\",\\"16:9\\",\\"9:16\\",\\"2:1\\",\\"1:2\\",\\"3:1\\",\\"1:3\\",\\"21:9\\",\\"9:21\\"",' +
      '"The aspect ratio of the generated image is set to auto by default.",' +
      '"resolution","\\"1K\\",\\"2K\\",\\"4K\\""];</script>';
    const { found, excerpt } = extractEmbeddedParameterData(html);
    expect(found).toBe(true);
    for (const r of ["1:1", "16:9", "9:16", "21:9", "9:21"]) {
      expect(excerpt).toContain(r);
    }
    expect(excerpt).toContain("aspect_ratio");
    expect(excerpt).toContain("1K");
  });

  it("drops numeric-ref scaffolding noise", () => {
    const html = '<script>x=[2050,2051,2052,2053],{"_5":2016,"_23":2048},"aspect_ratio","\\"1:1\\",\\"16:9\\""</script>';
    const { excerpt } = extractEmbeddedParameterData(html);
    expect(excerpt).not.toContain("2050,2051");
    expect(excerpt).toContain("16:9");
  });

  it("returns found=false when scripts carry no parameter signal", () => {
    const { found } = extractEmbeddedParameterData("<script>console.log(1)</script>");
    expect(found).toBe(false);
  });
});
