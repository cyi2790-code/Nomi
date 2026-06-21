import fs from "node:fs";
import path from "node:path";
import {
  ensureWorkspaceFolders,
  hasWorkspaceManifest,
  readProjectJsonFileWithEmbeddedMediaSlimming,
  readProjectJsonTopLevelFields,
  readWorkspaceManifest,
  readWorkspaceManifestSummary,
  writeWorkspaceManifest,
} from "./workspaceManifest";
import { workspaceNomiDir } from "./workspacePaths";
import { normalizeWorkspaceProjectRecord, type WorkspaceProjectRecordV2 } from "./workspaceTypes";

const LEGACY_PROJECT_FILE = "project.json";
const REMOVED_FROM_LIBRARY_MARKER = "removed-from-library";

type LegacyProjectRecord = Record<string, unknown>;

function legacyProjectFile(rootPath: string): string {
  return path.join(path.resolve(rootPath), LEGACY_PROJECT_FILE);
}

export function readLegacyProject(rootPath: string): LegacyProjectRecord | null {
  const filePath = legacyProjectFile(rootPath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readProjectJsonFileWithEmbeddedMediaSlimming(rootPath, filePath);
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as LegacyProjectRecord) : null;
  } catch {
    return null;
  }
}

function removedFromLibraryMarkerPath(rootPath: string): string {
  return path.join(workspaceNomiDir(rootPath), REMOVED_FROM_LIBRARY_MARKER);
}

export function isLegacyProjectSuppressed(rootPath: string): boolean {
  try {
    return fs.existsSync(removedFromLibraryMarkerPath(rootPath));
  } catch {
    return false;
  }
}

export function suppressLegacyProjectRediscovery(rootPath: string): void {
  ensureWorkspaceFolders(rootPath);
  fs.writeFileSync(removedFromLibraryMarkerPath(rootPath), `${Date.now()}\n`, "utf8");
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toWorkspaceRecord(rootPath: string, raw: LegacyProjectRecord): WorkspaceProjectRecordV2 {
  const now = Date.now();
  return normalizeWorkspaceProjectRecord({
    id: stringOrFallback(raw.id, `workspace-${now}`),
    name: stringOrFallback(raw.name, path.basename(path.resolve(rootPath)) || "Untitled Project"),
    version: 2,
    createdAt: numberOrFallback(raw.createdAt, now),
    updatedAt: numberOrFallback(raw.updatedAt, now),
    savedAt: numberOrFallback(raw.savedAt, numberOrFallback(raw.updatedAt, now)),
    revision: numberOrFallback(raw.revision, 0),
    lastKnownRootPath: path.resolve(rootPath),
    payload: raw.payload,
  });
}

export function readLegacyProjectSummary(rootPath: string): Omit<WorkspaceProjectRecordV2, "payload"> | null {
  const filePath = legacyProjectFile(rootPath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const fields = readProjectJsonTopLevelFields(filePath, {
      keys: ["id", "name", "createdAt", "updatedAt", "savedAt", "revision"],
      stopBeforeKeys: ["payload"],
    });
    if (!fields) {
      return null;
    }
    const { payload: _payload, ...summary } = toWorkspaceRecord(rootPath, fields);
    return summary;
  } catch {
    return null;
  }
}

export function migrateLegacyProjectFolder(rootPath: string): WorkspaceProjectRecordV2 | null {
  if (isLegacyProjectSuppressed(rootPath)) {
    return null;
  }
  if (hasWorkspaceManifest(rootPath)) {
    return readWorkspaceManifest(rootPath);
  }

  const legacy = readLegacyProject(rootPath);
  if (!legacy) {
    return null;
  }

  ensureWorkspaceFolders(rootPath);
  return writeWorkspaceManifest(rootPath, toWorkspaceRecord(rootPath, legacy));
}

export function discoverLegacyProjects(defaultProjectsRoot: string): WorkspaceProjectRecordV2[] {
  const root = path.resolve(defaultProjectsRoot);
  if (!fs.existsSync(root)) {
    return [];
  }

  const projects: WorkspaceProjectRecordV2[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const projectRoot = path.join(root, entry.name);
    if (isLegacyProjectSuppressed(projectRoot)) continue;
    if (hasWorkspaceManifest(projectRoot)) {
      const manifest = readWorkspaceManifestSummary(projectRoot);
      if (manifest) {
        projects.push({ ...manifest, lastKnownRootPath: path.resolve(projectRoot) });
      }
      continue;
    }
    const summary = readLegacyProjectSummary(projectRoot);
    if (summary) {
      projects.push(summary);
    }
  }
  return projects;
}
