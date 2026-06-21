import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  workspaceAssetsGeneratedDir,
  workspaceAssetsImportedDir,
  workspaceExportsDir,
  workspaceNomiDir,
  workspaceProjectFile,
} from "./workspacePaths";
import { normalizeWorkspaceProjectRecord, type WorkspaceProjectRecordV2 } from "./workspaceTypes";

export type WorkspaceProjectManifestSummary = Omit<WorkspaceProjectRecordV2, "payload">;

type SlimEmbeddedMediaResult = {
  text: string;
  changed: boolean;
  localized: number;
};

const SUMMARY_PREFIX_CHUNK_BYTES = 64 * 1024;
const SUMMARY_PREFIX_MAX_BYTES = 2 * 1024 * 1024;
const EMBEDDED_MEDIA_PATTERN = /"data:(image|video|audio)\/[^"]+"/g;
const DATA_URL_HEADER_PATTERN = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/;

function nowMs(): number {
  return performance.now();
}

function timeManifestStep<T>(label: string, work: () => T, warnMs = 250): T {
  const startedAt = nowMs();
  try {
    return work();
  } finally {
    const duration = nowMs() - startedAt;
    if (duration >= warnMs) {
      console.info(`[nomi:desktop:start] manifest.${label} took ${duration.toFixed(1)}ms`);
    }
  }
}

function safeFilePart(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "media";
}

function extensionFromMime(contentType: string, fallback = "bin"): string {
  const type = contentType.split(";")[0]?.trim().toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  if (type === "video/mp4") return "mp4";
  if (type === "video/webm") return "webm";
  if (type === "video/quicktime") return "mov";
  if (type === "audio/mpeg") return "mp3";
  if (type === "audio/wav" || type === "audio/x-wav") return "wav";
  return fallback;
}

function parseDataUrl(dataUrl: string): { bytes: Buffer; contentType: string } | null {
  const match = dataUrl.match(DATA_URL_HEADER_PATTERN);
  if (!match) return null;
  const contentType = match[1] || "application/octet-stream";
  const encoded = match[3] || "";
  try {
    const bytes = match[2] ? Buffer.from(encoded, "base64") : Buffer.from(decodeURIComponent(encoded));
    return { bytes, contentType };
  } catch {
    return null;
  }
}

function localAssetUrl(projectId: string, relativePath: string): string {
  return `nomi-local://asset/${encodeURIComponent(projectId)}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function uniqueEmbeddedMediaPath(
  rootPath: string,
  fileName: string,
  date: Date = new Date(),
): { absolutePath: string; relativePath: string } {
  const assetDir = workspaceAssetsGeneratedDir(rootPath, date);
  fs.mkdirSync(assetDir, { recursive: true });
  const parsed = path.parse(safeFilePart(fileName));
  const base = parsed.name || "media";
  const ext = parsed.ext || ".bin";
  let absolutePath = path.join(assetDir, `${base}${ext}`);
  for (let index = 2; fs.existsSync(absolutePath); index += 1) {
    absolutePath = path.join(assetDir, `${base}-${index}${ext}`);
  }
  return {
    absolutePath,
    relativePath: path.relative(rootPath, absolutePath).replace(/\\/g, "/"),
  };
}

function detectProjectIdFromJsonText(text: string): string {
  const match = text.match(/"id"\s*:\s*"([^"]+)"/);
  return match?.[1] ? match[1] : `workspace-${crypto.randomUUID()}`;
}

function slimEmbeddedMediaDataUrls(rootPath: string, text: string): SlimEmbeddedMediaResult {
  if (!text.includes("data:image/") && !text.includes("data:video/") && !text.includes("data:audio/")) {
    return { text, changed: false, localized: 0 };
  }
  const projectId = detectProjectIdFromJsonText(text);
  let localized = 0;
  const nextText = text.replace(EMBEDDED_MEDIA_PATTERN, (quoted) => {
    let value = "";
    try {
      value = JSON.parse(quoted) as string;
    } catch {
      return quoted;
    }
    const parsed = parseDataUrl(value);
    if (!parsed || parsed.bytes.byteLength === 0) return quoted;
    const ext = extensionFromMime(parsed.contentType, "bin");
    const { absolutePath, relativePath } = uniqueEmbeddedMediaPath(rootPath, `embedded-${localized + 1}.${ext}`);
    fs.writeFileSync(absolutePath, parsed.bytes);
    localized += 1;
    return JSON.stringify(localAssetUrl(projectId, relativePath));
  });
  return { text: nextText, changed: localized > 0, localized };
}

function readProjectJsonText(filePath: string, rootPath?: string, action = "parsing"): string {
  const raw = timeManifestStep("readProjectJsonText.fsRead", () => fs.readFileSync(filePath, "utf8"), 250);
  if (!rootPath) return raw;
  const slimmed = timeManifestStep(
    "readProjectJsonText.slimEmbeddedMedia",
    () => slimEmbeddedMediaDataUrls(rootPath, raw),
    250,
  );
  if (slimmed.changed) {
    timeManifestStep("readProjectJsonText.writeSlimmed", () => fs.writeFileSync(filePath, slimmed.text, "utf8"), 250);
    console.info(`[nomi:desktop] localized ${slimmed.localized} embedded project media URLs before ${action} ${filePath}`);
  }
  return slimmed.text;
}

function readJsonFile(filePath: string, rootPath?: string): unknown {
  const text = readProjectJsonText(filePath, rootPath, "parsing");
  return timeManifestStep("readJsonFile.parse", () => JSON.parse(text), 250);
}

export function readProjectJsonFileWithEmbeddedMediaSlimming(rootPath: string, filePath: string): unknown {
  const text = readProjectJsonText(filePath, rootPath, "parsing");
  return timeManifestStep("readProjectJsonFileWithEmbeddedMediaSlimming.parse", () => JSON.parse(text), 250);
}

function parseTopLevelJsonString(text: string, index: number): { value: string; end: number } | null {
  if (text[index] !== "\"") return null;
  let cursor = index + 1;
  let escaped = false;
  while (cursor < text.length) {
    const char = text[cursor];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "\"") {
      const raw = text.slice(index, cursor + 1);
      try {
        return { value: JSON.parse(raw) as string, end: cursor + 1 };
      } catch {
        return null;
      }
    }
    cursor += 1;
  }
  return null;
}

function skipWhitespace(text: string, index: number): number {
  let cursor = index;
  while (/\s/.test(text[cursor] || "")) cursor += 1;
  return cursor;
}

function parseTopLevelPrimitive(text: string, index: number): { value: unknown; end: number } | null {
  const cursor = skipWhitespace(text, index);
  if (text[cursor] === "\"") return parseTopLevelJsonString(text, cursor);
  const match = text.slice(cursor).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|^(?:true|false|null)/);
  if (!match) return null;
  const raw = match[0];
  try {
    return { value: JSON.parse(raw), end: cursor + raw.length };
  } catch {
    return null;
  }
}

function skipTopLevelValue(text: string, index: number): number {
  let cursor = skipWhitespace(text, index);
  if (text[cursor] === "\"") return parseTopLevelJsonString(text, cursor)?.end ?? cursor + 1;
  if (text[cursor] !== "{" && text[cursor] !== "[") {
    while (cursor < text.length && text[cursor] !== "," && text[cursor] !== "}") cursor += 1;
    return cursor;
  }
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  while (cursor < text.length) {
    const char = text[cursor];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
    } else if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      stack.push("}");
    } else if (char === "[") {
      stack.push("]");
    } else if ((char === "}" || char === "]") && stack.length > 0) {
      const expected = stack.pop();
      if (char !== expected) return cursor + 1;
      if (stack.length === 0) return cursor + 1;
    }
    cursor += 1;
  }
  return cursor;
}

function readTopLevelJsonPrimitiveFieldsFromText(
  text: string,
  options: { keys?: readonly string[]; requiredKeys?: readonly string[]; stopBeforeKeys?: readonly string[] } = {},
): Record<string, unknown> | null {
  const fields: Record<string, unknown> = {};
  const targetKeys = options.keys ? new Set(options.keys) : null;
  const requiredKeys = options.requiredKeys ?? [];
  const stopBeforeKeys = new Set(options.stopBeforeKeys ?? []);
  let cursor = skipWhitespace(text, 0);
  if (text[cursor] !== "{") return null;
  cursor += 1;
  while (cursor < text.length) {
    cursor = skipWhitespace(text, cursor);
    if (text[cursor] === "}") break;
    const key = parseTopLevelJsonString(text, cursor);
    if (!key) return null;
    cursor = skipWhitespace(text, key.end);
    if (text[cursor] !== ":") return null;
    cursor += 1;
    if (stopBeforeKeys.has(key.value)) break;
    const primitive = parseTopLevelPrimitive(text, cursor);
    if (primitive) {
      if (!targetKeys || targetKeys.has(key.value)) {
        fields[key.value] = primitive.value;
      }
      cursor = primitive.end;
    } else {
      cursor = skipTopLevelValue(text, cursor);
    }
    if (requiredKeys.length > 0 && requiredKeys.every((field) => Object.prototype.hasOwnProperty.call(fields, field))) {
      return fields;
    }
    if (requiredKeys.length === 0 && targetKeys && options.keys?.every((field) => Object.prototype.hasOwnProperty.call(fields, field))) {
      return fields;
    }
    cursor = skipWhitespace(text, cursor);
    if (text[cursor] === ",") cursor += 1;
  }
  return fields;
}

function readManifestSummaryFromText(text: string): WorkspaceProjectManifestSummary | null {
  const fields = readTopLevelJsonPrimitiveFieldsFromText(text, { stopBeforeKeys: ["payload"] });
  if (!fields) return null;
  try {
    const normalized = normalizeWorkspaceProjectRecord(fields);
    const { payload: _payload, ...summary } = normalized;
    return summary;
  } catch {
    return null;
  }
}

export function readProjectJsonTopLevelFields(
  filePath: string,
  options: {
    keys?: readonly string[];
    localizeEmbeddedMedia?: boolean;
    maxPrefixBytes?: number;
    requiredKeys?: readonly string[];
    rootPath?: string;
    stopBeforeKeys?: readonly string[];
  } = {},
): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  if (options.localizeEmbeddedMedia && options.rootPath) {
    const text = readProjectJsonText(filePath, options.rootPath, "reading summary");
    return readTopLevelJsonPrimitiveFieldsFromText(text, {
      keys: options.keys,
      requiredKeys: options.requiredKeys,
      stopBeforeKeys: options.stopBeforeKeys,
    });
  }

  const maxPrefixBytes = options.maxPrefixBytes ?? SUMMARY_PREFIX_MAX_BYTES;
  const stat = fs.statSync(filePath);
  const bytesToRead = Math.min(stat.size, maxPrefixBytes);
  if (bytesToRead <= 0) {
    return null;
  }
  const fd = fs.openSync(filePath, "r");
  const chunks: Buffer[] = [];
  let bytesReadTotal = 0;
  try {
    while (bytesReadTotal < bytesToRead) {
      const chunkSize = Math.min(SUMMARY_PREFIX_CHUNK_BYTES, bytesToRead - bytesReadTotal);
      const buffer = Buffer.allocUnsafe(chunkSize);
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, bytesReadTotal);
      if (bytesRead <= 0) break;
      bytesReadTotal += bytesRead;
      chunks.push(buffer.subarray(0, bytesRead));
      const prefix = Buffer.concat(chunks, bytesReadTotal).toString("utf8");
      const fields = readTopLevelJsonPrimitiveFieldsFromText(prefix, {
        keys: options.keys,
        requiredKeys: options.requiredKeys,
        stopBeforeKeys: options.stopBeforeKeys,
      });
      const hasRequiredFields = !!options.requiredKeys?.length &&
        options.requiredKeys.every((field) => Object.prototype.hasOwnProperty.call(fields ?? {}, field));
      const hasRequestedFields = !!options.keys?.length &&
        options.keys.every((field) => Object.prototype.hasOwnProperty.call(fields ?? {}, field));
      const complete = bytesReadTotal >= stat.size;
      if (fields && (hasRequiredFields || hasRequestedFields || (!options.keys?.length && complete))) {
        return fields;
      }
      if (complete || options.stopBeforeKeys?.some((key) => prefix.includes(`"${key}"`))) {
        return fields;
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  if (stat.size <= maxPrefixBytes && chunks.length > 0) {
    const text = Buffer.concat(chunks, bytesReadTotal).toString("utf8");
    return readTopLevelJsonPrimitiveFieldsFromText(text, {
      keys: options.keys,
      requiredKeys: options.requiredKeys,
      stopBeforeKeys: options.stopBeforeKeys,
    });
  }
  return null;
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function workspaceId(): string {
  return `workspace-${crypto.randomUUID()}`;
}

export function hasWorkspaceManifest(rootPath: string): boolean {
  return fs.existsSync(workspaceProjectFile(rootPath));
}

export function readWorkspaceManifest(rootPath: string): WorkspaceProjectRecordV2 | null {
  const filePath = workspaceProjectFile(rootPath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return normalizeWorkspaceProjectRecord(readJsonFile(filePath, rootPath));
}

export function readWorkspaceManifestSummary(rootPath: string): WorkspaceProjectManifestSummary | null {
  const filePath = workspaceProjectFile(rootPath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const fields = readProjectJsonTopLevelFields(filePath, {
    keys: ["id", "name", "version", "createdAt", "updatedAt", "savedAt", "revision", "lastKnownRootPath"],
    stopBeforeKeys: ["payload"],
  });
  if (fields) {
    try {
      const { payload: _payload, ...summary } = normalizeWorkspaceProjectRecord(fields);
      return summary;
    } catch {
      // Fall through to full parsing for small malformed or unusually ordered manifests.
    }
  }
  const stat = fs.statSync(filePath);
  if (stat.size > SUMMARY_PREFIX_MAX_BYTES) {
    return null;
  }
  const text = fs.readFileSync(filePath, "utf8");
  return readManifestSummaryFromText(text) ?? (() => {
    const { payload: _payload, ...summary } = normalizeWorkspaceProjectRecord(JSON.parse(text));
    return summary;
  })();
}

export function writeWorkspaceManifest(rootPath: string, record: WorkspaceProjectRecordV2): WorkspaceProjectRecordV2 {
  const normalized = normalizeWorkspaceProjectRecord(record);
  writeJsonFile(workspaceProjectFile(rootPath), normalized);
  return normalized;
}

export function ensureWorkspaceFolders(rootPath: string): void {
  fs.mkdirSync(workspaceNomiDir(rootPath), { recursive: true });
  fs.mkdirSync(workspaceAssetsGeneratedDir(rootPath), { recursive: true });
  fs.mkdirSync(workspaceAssetsImportedDir(rootPath), { recursive: true });
  fs.mkdirSync(workspaceExportsDir(rootPath), { recursive: true });
}

export function initializeWorkspace(
  rootPath: string,
  input: { name?: string; payload?: unknown } = {},
): WorkspaceProjectRecordV2 {
  ensureWorkspaceFolders(rootPath);
  const existing = readWorkspaceManifest(rootPath);
  if (existing) {
    return existing;
  }

  const resolvedRoot = path.resolve(rootPath);
  const now = Date.now();
  const record: WorkspaceProjectRecordV2 = normalizeWorkspaceProjectRecord({
    id: workspaceId(),
    name: input.name?.trim() || path.basename(resolvedRoot) || "Untitled Workspace",
    version: 2,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    revision: 0,
    lastKnownRootPath: resolvedRoot,
    payload: input.payload,
  });
  return writeWorkspaceManifest(rootPath, record);
}
