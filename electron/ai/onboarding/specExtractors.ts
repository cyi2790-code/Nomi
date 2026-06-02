/**
 * Schema-first parameter extraction for onboarding.
 *
 * Why this exists: the curl-blueprint path treats the docs' curl example body as
 * the source of truth for user-facing parameters. But a curl example is a
 * *minimal happy-path sample* — it omits optional params and only shows one
 * value for each enum. The real parameter contract (every field, every allowed
 * enum value, defaults, required flags) lives in:
 *
 *   1. an OpenAPI / Swagger / JSON-Schema embedded in or linked from the page
 *      → `extractOpenApiOperations` parses it deterministically.
 *   2. a dehydrated SPA store (Apidog / Next / Nuxt) where the same strings are
 *      present but interned + JSON-in-JSON escaped, so `htmlToMarkdown` (which
 *      strips <script>) hides them from the agent. Two layers:
 *      → `extractDehydratedParameters` deterministically recovers enum params
 *        (full option sets + defaults) into the same DocOperation shape as the
 *        OpenAPI path — the agent uses them verbatim, no mining. PREFERRED.
 *      → `extractEmbeddedParameterData` is the last-resort digest: when even the
 *        structured recovery finds nothing, it resurfaces raw fragments for the
 *        LLM to read. Noisy + token-heavy, so gated to truly empty cases.
 *
 * Keep this module free of Electron globals (shared with the Lab CLI).
 */
import type { FieldDefinition, FieldEvidence, ParameterControlType, ParameterOption } from "./types";

export type DocOperation = {
  method: string;
  path: string;
  summary?: string;
  /** Ready-to-apply fields (evidence pre-attached) for set_fields. */
  fields: FieldDefinition[];
};

type JsonObj = Record<string, unknown>;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
// Keys that are server-side wiring or request/response envelope — never a
// user-facing generation param. Covers the common shapes across aggregators:
//   - auth/model selection (handled by set_vendor_info, not a field)
//   - async job envelope: callbacks + webhooks (kie callBackUrl, replicate webhook)
//   - response/echo fields that leak into combined OpenAPI schemas
//     (id/created_at/status/urls on replicate's createPrediction)
// This list is intentionally limited to fields that are NEVER generation params
// on ANY provider — we'd rather keep a borderline param than drop a real one.
const WIRING_KEY =
  /^(model|api[-_]?key|apikey|token|secret|user_token|authorization|stream|callback|callback[-_]?url|webhook|webhooks|webhook[-_]?events?[-_]?filter|id|status|error|logs|metrics|urls|created[-_]?at|updated[-_]?at|completed[-_]?at|started[-_]?at|deployment|version|context|output[-_]?file[-_]?prefix)$/i;

function isObj(v: unknown): v is JsonObj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Unescape one level of JSON-in-JSON (e.g. Apidog's `\"1:1\"` → `"1:1"`). */
function unescapeJsonInJson(text: string): string {
  return text
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/")
    .replace(/\\n/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\\\/g, "\\");
}

// =================================================================
// 1. Deterministic OpenAPI / Swagger extraction
// =================================================================

/** Scan from an opening brace and return the balanced {...} slice (string-aware). */
function extractBalancedObject(text: string, start: number): string | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Depth-limited search for OpenAPI/Swagger root objects inside a parsed JSON. */
function collectSpecRoots(node: unknown, out: JsonObj[], depth = 0): void {
  if (depth > 6 || !node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectSpecRoots(item, out, depth + 1);
    return;
  }
  if (!isObj(node)) return;
  if (("openapi" in node || "swagger" in node) && isObj(node.paths)) {
    out.push(node);
    return; // don't descend into a spec we already found
  }
  for (const value of Object.values(node)) collectSpecRoots(value, out, depth + 1);
}

/** Find candidate OpenAPI/Swagger root objects embedded in the page HTML. */
function findOpenApiRoots(html: string): JsonObj[] {
  const roots: JsonObj[] = [];
  const seen = new Set<string>();
  const push = (root: JsonObj) => {
    // Content-aware signature: keys alone would drop a RICHER second embedding
    // of the same paths (Replicate renders the spec twice). Include a size
    // fingerprint so distinct embeddings survive; op-level dedupe keeps the
    // richer one. Only byte-identical embeddings collapse here.
    const sig = `${Object.keys(root.paths as JsonObj).join(",")}:${JSON.stringify(root.paths).length}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    roots.push(root);
  };

  // a. <script type="application/json"> blobs (Redoc / Swagger UI / Next data).
  const scriptRe = /<script[^>]*type=["']application\/(?:json|ld\+json)["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    const found: JsonObj[] = [];
    collectSpecRoots(tryParse(m[1].trim()), found);
    found.forEach(push);
  }

  // b. Inline `{"openapi": ...}` / `{"swagger": ...}` via balanced scan, both as
  //    raw JSON and after unescaping one JSON-in-JSON level.
  for (const anchor of ['"openapi"', '"swagger"']) {
    let idx = html.indexOf(anchor);
    while (idx !== -1) {
      const start = html.lastIndexOf("{", idx);
      if (start >= 0) {
        const slice = extractBalancedObject(html, start);
        if (slice) {
          const parsed = tryParse(slice) ?? tryParse(unescapeJsonInJson(slice));
          const found: JsonObj[] = [];
          collectSpecRoots(parsed, found);
          found.forEach(push);
        }
      }
      idx = html.indexOf(anchor, idx + anchor.length);
    }
  }

  return roots;
}

/** Resolve a local `#/components/...` (or swagger `#/definitions/...`) $ref. */
function resolveRef(root: JsonObj, ref: unknown, seen: Set<string>): JsonObj | null {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  if (seen.has(ref)) return null; // cycle guard
  seen.add(ref);
  let node: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObj(node)) return null;
    node = node[key];
  }
  return isObj(node) ? node : null;
}

function deref(root: JsonObj, schema: unknown, seen: Set<string>): JsonObj | null {
  if (!isObj(schema)) return null;
  if (typeof schema.$ref === "string") {
    const resolved = resolveRef(root, schema.$ref, seen);
    return resolved ? deref(root, resolved, seen) : null;
  }
  return schema;
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function controlTypeFor(schema: JsonObj, hasOptions: boolean): ParameterControlType {
  if (hasOptions) return "select";
  const t = String(schema.type || "").toLowerCase();
  if (t === "integer" || t === "number") return "number";
  if (t === "boolean") return "boolean";
  return "text";
}

function optionsFromEnum(values: unknown): ParameterOption[] {
  if (!Array.isArray(values)) return [];
  const out: ParameterOption[] = [];
  for (const v of values) {
    if (v === null || typeof v === "object") continue;
    const value = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : String(v);
    out.push({ value, label: String(v) });
  }
  return out;
}

function scalarDefault(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return undefined;
}

/** Recursively turn a request-body object schema into flat DocParameter fields. */
function expandSchema(
  root: JsonObj,
  schema: JsonObj,
  pathPrefix: string[],
  requiredHere: Set<string>,
  method: string,
  apiPath: string,
  out: FieldDefinition[],
  seenRefs: Set<string>,
): void {
  const node = deref(root, schema, seenRefs);
  if (!node) return;
  // Object → descend into properties.
  const props = isObj(node.properties) ? node.properties : null;
  if (props) {
    const requiredList = Array.isArray(node.required) ? node.required.map(String) : [];
    const requiredSet = new Set(requiredList);
    for (const [key, rawChild] of Object.entries(props)) {
      if (WIRING_KEY.test(key)) continue;
      const child = deref(root, rawChild, new Set(seenRefs));
      if (!child) continue;
      const childProps = isObj(child.properties) ? child.properties : null;
      const isLeaf = !childProps && String(child.type || "").toLowerCase() !== "object";
      if (isLeaf) {
        emitField(child, [...pathPrefix, key], requiredSet.has(key), method, apiPath, out);
      } else {
        // nested object — recurse, tracking dotted path
        expandSchema(root, child, [...pathPrefix, key], requiredSet, method, apiPath, out, new Set(seenRefs));
      }
    }
    return;
  }
  // Leaf at this level (rare for a top-level body, but handle gracefully).
  if (pathPrefix.length > 0) {
    const leafKey = pathPrefix[pathPrefix.length - 1];
    emitField(node, pathPrefix, requiredHere.has(leafKey), method, apiPath, out);
  }
}

function emitField(
  schema: JsonObj,
  dotPathParts: string[],
  required: boolean,
  method: string,
  apiPath: string,
  out: FieldDefinition[],
): void {
  const dotPath = dotPathParts.join(".");
  const leafKey = dotPathParts[dotPathParts.length - 1];
  if (!leafKey || WIRING_KEY.test(leafKey)) return;
  const options = optionsFromEnum(schema.enum);
  const type = controlTypeFor(schema, options.length > 0);
  const description = typeof schema.description === "string" ? schema.description.trim() : "";
  const def = scalarDefault(schema.default);

  const evidenceText =
    `OpenAPI ${method.toUpperCase()} ${apiPath} · property "${dotPath}" (${schema.type || type}` +
    `${required ? ", required" : ""}${options.length ? `, enum: ${options.map((o) => o.value).join(", ")}` : ""})` +
    `${description ? ` — ${description}` : ""}`;
  const evidence: FieldEvidence = {
    field: leafKey,
    evidence: evidenceText.length >= 20 ? evidenceText : `${evidenceText} (from OpenAPI schema)`,
    evidence_location: `OpenAPI ${method.toUpperCase()} ${apiPath}`,
    confidence: "high",
  };

  const field: FieldDefinition = {
    key: leafKey,
    displayName: humanizeKey(leafKey),
    type,
    ...(options.length ? { options } : {}),
    ...(def !== undefined ? { default: def } : {}),
    evidence,
  };
  // De-dupe by key: last writer wins but don't add duplicates.
  const existing = out.findIndex((f) => f.key === field.key);
  if (existing >= 0) out[existing] = field;
  else out.push(field);
}

function paramFieldsFromParameters(root: JsonObj, parameters: unknown, method: string, apiPath: string, out: FieldDefinition[]): void {
  if (!Array.isArray(parameters)) return;
  for (const raw of parameters) {
    const p = deref(root, raw, new Set());
    if (!p) continue;
    const where = String(p.in || "").toLowerCase();
    if (where !== "query") continue; // body handled separately; skip path/header
    const name = typeof p.name === "string" ? p.name : "";
    if (!name || WIRING_KEY.test(name)) continue;
    const schema = isObj(p.schema) ? p.schema : p;
    emitField(schema, [name], Boolean(p.required), method, apiPath, out);
  }
}

/**
 * Deterministically extract every operation's request-parameter contract from
 * any OpenAPI / Swagger spec embedded in the page. Returns [] when no parseable
 * spec is present (e.g. Apidog dehydrated stores → use extractEmbeddedParameterData).
 */
export function extractOpenApiOperations(html: string): DocOperation[] {
  const roots = findOpenApiRoots(html);
  const ops: DocOperation[] = [];
  for (const root of roots) {
    const paths = isObj(root.paths) ? root.paths : {};
    for (const [apiPath, rawItem] of Object.entries(paths)) {
      if (!isObj(rawItem)) continue;
      for (const method of HTTP_METHODS) {
        const op = rawItem[method];
        if (!isObj(op)) continue;
        const fields: FieldDefinition[] = [];
        // request body (application/json) schema
        const reqBody = deref(root, op.requestBody, new Set());
        const content = reqBody && isObj(reqBody.content) ? reqBody.content : null;
        const jsonMedia = content && isObj(content["application/json"]) ? content["application/json"] : null;
        if (jsonMedia && jsonMedia.schema) {
          expandSchema(root, jsonMedia.schema as JsonObj, [], new Set(), method, apiPath, fields, new Set());
        }
        // query parameters
        paramFieldsFromParameters(root, op.parameters, method, apiPath, fields);
        paramFieldsFromParameters(root, rawItem.parameters, method, apiPath, fields);
        if (fields.length === 0) continue;
        ops.push({
          method: method.toUpperCase(),
          path: apiPath,
          ...(typeof op.summary === "string" ? { summary: op.summary } : {}),
          fields,
        });
      }
    }
  }
  // Dedupe by method+path. A page can embed the same spec twice (e.g. Replicate
  // renders it in both a <script> and inline), yielding two ops for one path —
  // confusing for the agent. Keep the richer one (more fields).
  const byKey = new Map<string, DocOperation>();
  for (const op of ops) {
    const key = `${op.method} ${op.path}`;
    const prev = byKey.get(key);
    if (!prev || op.fields.length > prev.fields.length) byKey.set(key, op);
  }
  return [...byKey.values()];
}

// =================================================================
// 1b. Lazy-loaded spec discovery (follow-link secondary fetch)
// =================================================================
//
// Some doc pages don't embed the OpenAPI spec in the served HTML — they fetch
// it client-side (fal.ai's Next/RSC shell loads `/api/openapi/queue/openapi.json
// ?endpoint_id=<model>`; various Redoc/Swagger pages reference an external
// `*-openapi.json` / `swagger.json`). For those, inline extraction returns []
// and the only way to get the contract is a SECOND fetch of the spec URL.
//
// extractSpecLinks finds those candidate URLs in the HTML (relative + absolute)
// and resolves them against the page URL. The caller (fetch_raw_docs) fetches
// each and runs extractOpenApiOperations on the JSON. Precision matters: we only
// accept URLs that look like a machine-readable spec (openapi/swagger + .json),
// never arbitrary .json assets (which would waste fetches on i18n/config blobs).

// A URL path that names an OpenAPI/Swagger JSON document. Matches:
//   /api/openapi/queue/openapi.json   (fal.ai)
//   /static/openapi.json, /v1/swagger.json, /openapi/v3/api-docs (springdoc)
//   …-openapi.json, swagger-spec.json
const SPEC_URL_RE =
  /(?:https?:\/\/[^\s"'<>()\\]+|\/[^\s"'<>()\\]*)?(?:openapi|swagger|api-docs)[^\s"'<>()\\]*?(?:\.json|\b)(?:\?[^\s"'<>()\\]*)?/gi;

/**
 * Discover candidate external OpenAPI/Swagger spec URLs referenced by the page
 * but NOT embedded in it. Returns absolute URLs (resolved against pageUrl),
 * deduped, capped. Empty when the page references no spec document.
 */
export function extractSpecLinks(html: string, pageUrl: string, max = 5): string[] {
  let base: URL | null = null;
  try {
    base = new URL(pageUrl);
  } catch {
    base = null;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const consider = (raw: string) => {
    let cleaned = raw.trim().replace(/\\\//g, "/").replace(/&amp;/g, "&");
    // strip leading garbage so a match like `:"/api/openapi.json"` resolves
    cleaned = cleaned.replace(/^[^/h]*?(?=https?:\/\/|\/)/i, "");
    if (!cleaned) return;
    // must reference a spec document — guard against generic .json assets that
    // merely contain the word in a hash/path segment we don't want.
    if (!/(?:openapi|swagger|api-docs)/i.test(cleaned)) return;
    let resolved: string;
    try {
      resolved = base ? new URL(cleaned, base).toString() : new URL(cleaned).toString();
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(resolved)) return;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    out.push(resolved);
  };

  let m: RegExpExecArray | null;
  SPEC_URL_RE.lastIndex = 0;
  while ((m = SPEC_URL_RE.exec(html)) !== null && out.length < max * 4) {
    // require a path-ish or url-ish match (skip bare "openapi" words in prose)
    const hit = m[0];
    if (!/[/.]/.test(hit)) continue;
    consider(hit);
  }
  return out.slice(0, max);
}

// =================================================================
// 2. Structured dehydrated-store parameter extraction (Apidog et al.)
// =================================================================
//
// Real case: kie.ai's Apidog doc embeds the contract as an interned/
// dehydrated object graph (numeric refs + JSON-in-JSON escaping). There is
// NO parseable `{"openapi":...}` object (so extractOpenApiOperations returns
// []), yet the enum value lists ARE present as adjacent quoted-token runs:
//
//   "aspect_ratio",{refs},"The aspect ratio ... set to auto by default.",
//      [2050,...,2065],"auto","1:1","3:2",...,"9:21",[2067,...]
//   "resolution",{refs},[2087,2088,2089],"1K","2K","4K",[2091,...]
//
// The page also carries a clean `"method","post","path","/api/v1/.../createTask"`
// run. We mine these deterministically into the SAME DocOperation shape that
// the OpenAPI path produces, so the agent consumes them verbatim via
// fetch_raw_docs.openapi_parameters — no LLM mining of a noisy digest.
//
// Precision over recall: a page like this contains ~80 enum-shaped runs that
// are pure scaffolding (navbar, config, locale lists). We only accept a run
// whose nearest preceding identifier is a known generation-parameter name.

// Exact-match vocabulary of user-facing generation params. Anchored to avoid
// matching structural keys (tagName/method/apiDetail/...). Expand as needed.
const GEN_PARAM_NAME =
  /^(prompt|negative[_-]?prompt|aspect[_-]?ratio|ratio|resolution|size|image[_-]?size|duration|quality|style|seed|width|height|steps|num[_-]?inference[_-]?steps|guidance|guidance[_-]?scale|cfg|cfg[_-]?scale|format|output[_-]?format|sampler|scheduler|strength|num[_-]?images|n|fps|motion|loop|background|voice|language|model[_-]?version|variant)$/i;
const BARE_ID = /"([a-zA-Z][a-zA-Z0-9_]{1,40})"/g;
// A run of >=2 short quoted tokens (the enum values). Same shape as ENUM_RUN
// below but compiled separately so the two scans don't share lastIndex.
const ENUM_RUN_STRUCT = /(?:"[^"\n]{1,24}"\s*,\s*){1,}"[^"\n]{1,24}"/g;

/** Pull a human description (a spacey quoted string) near the enum run. */
function pickDescriptionNear(ctx: string): string {
  let best = "";
  const re = /"([^"\\\n]{20,200})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ctx)) !== null) {
    const s = m[1];
    // descriptions contain spaces; enum tokens / ids / paths don't (much)
    if (/\s/.test(s) && !s.startsWith("/") && s.length > best.length) best = s;
  }
  return best.trim();
}

/** Recover a default value from a description, validated against the options. */
function defaultFromDescription(desc: string, opts: string[]): string | undefined {
  if (!desc) return undefined;
  const patterns = [
    /set to "?([\w:.\-]+)"? by default/i,
    /defaults?\s+(?:to|is|value)?\s*[:=]?\s*"?([\w:.\-]+)"?/i,
    /"?([\w:.\-]+)"?\s+by default/i,
  ];
  for (const p of patterns) {
    const m = p.exec(desc);
    if (m && opts.includes(m[1])) return m[1];
  }
  return undefined;
}

/**
 * Extract a single operation's enum parameters from a dehydrated SPA store.
 * Returns [] when no generation-param enum runs are present. Method/path are
 * best-effort (the curl blueprint remains the source of truth for the request);
 * the value here is the COMPLETE option sets the curl sample lacks.
 */
export function extractDehydratedParameters(html: string): DocOperation[] {
  const scripts: string[] = [];
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let s: RegExpExecArray | null;
  while ((s = scriptRe.exec(html)) !== null) {
    if (s[1] && s[1].length > 0) scripts.push(s[1]);
  }
  if (scripts.length === 0) return [];
  const corpus = unescapeJsonInJson(unescapeJsonInJson(scripts.join("\n")));

  // Best-effort method + path from a clean `"method","post","path","/x"` run.
  let method = "POST";
  let apiPath = "(see request example)";
  const mp = /"method"\s*,\s*"(get|post|put|patch|delete)"\s*,\s*"path"\s*,\s*"(\/[^"]+)"/i.exec(corpus);
  if (mp) {
    method = mp[1].toUpperCase();
    apiPath = mp[2];
  }

  const fields: FieldDefinition[] = [];
  ENUM_RUN_STRUCT.lastIndex = 0;
  let e: RegExpExecArray | null;
  while ((e = ENUM_RUN_STRUCT.exec(corpus)) !== null) {
    const runStr = e[0];
    const before = corpus.slice(Math.max(0, e.index - 220), e.index);
    // Signature of a real Apidog enum: the value run is the dereferenced labels
    // of a numeric ref array, so it is IMMEDIATELY preceded by `[<digits>,...],`.
    // CSS/nav/locale runs (false positives) are preceded by `},` or a string.
    // This is the discriminator that separates the 2 real params from ~80 noise
    // runs on the page.
    const refArrayMatch = /\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]\s*,?\s*$/.exec(before);
    if (!refArrayMatch) continue;
    // The ref array's length == the enum cardinality (one ref per value). Use it
    // to cap the value run so adjacent metadata keys (e.g. Apidog's
    // "x-apidog-enum") and the next param's tokens don't bleed in. Principled:
    // the dereferenced-label array IS the enum, by construction.
    const refCount = refArrayMatch[1].split(",").length;
    // nearest preceding bare identifier that is a known generation param
    const ids: string[] = [];
    BARE_ID.lastIndex = 0;
    let idm: RegExpExecArray | null;
    while ((idm = BARE_ID.exec(before)) !== null) ids.push(idm[1]);
    let name = "";
    for (let i = ids.length - 1; i >= 0; i -= 1) {
      if (GEN_PARAM_NAME.test(ids[i]) && !WIRING_KEY.test(ids[i])) {
        name = ids[i];
        break;
      }
    }
    if (!name) continue;

    // parse + dedupe the option values, capped to the ref-array cardinality and
    // with OpenAPI/Apidog extension keys (x-apidog-enum, x-enum-varnames, ...)
    // filtered out as a guard.
    const rawOpts = [...runStr.matchAll(/"([^"\n]{1,24})"/g)]
      .map((x) => x[1])
      .filter((v) => !/^x-[a-z][a-z-]*$/i.test(v))
      .slice(0, refCount);
    const optValues: string[] = [];
    for (const v of rawOpts) if (!optValues.includes(v)) optValues.push(v);
    if (optValues.length < 2) continue;

    const ctx = corpus.slice(Math.max(0, e.index - 240), e.index + runStr.length + 240);
    const desc = pickDescriptionNear(ctx);
    const def = defaultFromDescription(desc, optValues);

    const options: ParameterOption[] = optValues.map((v) => ({ value: v, label: v }));
    const evidenceText =
      `Dehydrated API spec · "${name}" enum: ${optValues.join(", ")}` + (desc ? ` — ${desc}` : "");
    const field: FieldDefinition = {
      key: name,
      displayName: humanizeKey(name),
      type: "select",
      options,
      ...(def !== undefined ? { default: def } : {}),
      evidence: {
        field: name,
        evidence: evidenceText.length >= 20 ? evidenceText : `${evidenceText} (embedded spec)`,
        evidence_location: `Embedded API spec (dehydrated store) · ${method} ${apiPath}`,
        confidence: "high",
      },
    };
    const existing = fields.findIndex((f) => f.key === field.key);
    // Keep the richer option set if we see the same param twice.
    if (existing >= 0) {
      if ((field.options?.length || 0) > (fields[existing].options?.length || 0)) fields[existing] = field;
    } else {
      fields.push(field);
    }
  }

  if (fields.length === 0) return [];
  return [{ method, path: apiPath, fields }];
}

// =================================================================
// 3. Embedded-data digest (dehydrated SPA stores: Apidog / Next / Nuxt)
// =================================================================

export type EmbeddedDigest = { found: boolean; excerpt: string };

const DIGEST_KEYWORDS =
  /(prompt|aspect[_ -]?ratio|resolution|\bsize\b|duration|quality|style|seed|negative|width|height|steps|guidance|cfg|format|enum|default|required|allowed|可选|默认|必填|参数)/i;
// A run of >=3 short quoted tokens → very likely an enum array (e.g. "1:1","16:9",...).
const ENUM_RUN = /(?:"[^"\n]{1,24}"\s*,\s*){2,}"[^"\n]{1,24}"/g;

/**
 * Resurface parameter names, enum value arrays, and descriptions that live in
 * the page's <script> blobs (interned / JSON-in-JSON escaped) which htmlToMarkdown
 * strips out. Produces a focused, deduped, capped digest for the onboarding LLM.
 */
export function extractEmbeddedParameterData(html: string, maxChars = 24_000): EmbeddedDigest {
  const scripts: string[] = [];
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    if (m[1] && m[1].length > 0) scripts.push(m[1]);
  }
  // Unescape twice to handle double-escaped (JSON-in-JSON-in-JSON) stores.
  const corpus = unescapeJsonInJson(unescapeJsonInJson(scripts.join("\n")));

  const fragments: string[] = [];
  const seen = new Set<string>();
  const add = (frag: string) => {
    const cleaned = frag
      // drop pure numeric-ref arrays ([2050,2051,...]) and {"_NNN":NNN} maps
      .replace(/\[\s*(?:\d+\s*,\s*)+\d+\s*\]/g, " ")
      .replace(/\{\s*(?:"_\d+"\s*:\s*-?\d+\s*,?\s*)+\}/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 8) return;
    const key = cleaned.slice(0, 120);
    if (seen.has(key)) return;
    seen.add(key);
    fragments.push(cleaned);
  };

  // a. enum runs (with a little surrounding context so the LLM sees the param name)
  let e: RegExpExecArray | null;
  while ((e = ENUM_RUN.exec(corpus)) !== null) {
    const from = Math.max(0, e.index - 80);
    add(corpus.slice(from, e.index + e[0].length + 8));
  }
  // b. keyword windows (param names + descriptions)
  const kw = new RegExp(DIGEST_KEYWORDS.source, "gi");
  let k: RegExpExecArray | null;
  while ((k = kw.exec(corpus)) !== null) {
    add(corpus.slice(Math.max(0, k.index - 60), k.index + 200));
    if (fragments.length > 400) break; // safety
  }

  let excerpt = "";
  for (const frag of fragments) {
    if (excerpt.length + frag.length + 1 > maxChars) break;
    excerpt += (excerpt ? "\n" : "") + frag;
  }
  return { found: excerpt.length > 0, excerpt };
}
