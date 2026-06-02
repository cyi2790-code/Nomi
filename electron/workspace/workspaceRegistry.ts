import fs from "node:fs";
import path from "node:path";
import { normalizeRecentWorkspaceEntry, type RecentWorkspaceEntry, type WorkspaceProjectRecordV2 } from "./workspaceTypes";

function writeRecentWorkspaces(settingsRoot: string, entries: RecentWorkspaceEntry[]): void {
  fs.mkdirSync(settingsRoot, { recursive: true });
  fs.writeFileSync(recentWorkspacesPath(settingsRoot), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

function sortRecentWorkspaces(entries: RecentWorkspaceEntry[]): RecentWorkspaceEntry[] {
  return [...entries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.name.localeCompare(b.name));
}

function withMissingState(entry: RecentWorkspaceEntry): RecentWorkspaceEntry {
  return {
    ...entry,
    missing: !fs.existsSync(entry.rootPath),
  };
}

export function recentWorkspacesPath(settingsRoot: string): string {
  return path.join(path.resolve(settingsRoot), "recent-workspaces.json");
}

export function listRecentWorkspaces(settingsRoot: string): RecentWorkspaceEntry[] {
  const registryPath = recentWorkspacesPath(settingsRoot);
  if (!fs.existsSync(registryPath)) {
    return [];
  }
  const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (!Array.isArray(raw)) {
    return [];
  }
  return sortRecentWorkspaces(raw.map((entry) => withMissingState(normalizeRecentWorkspaceEntry(entry))));
}

export function rememberWorkspace(settingsRoot: string, record: WorkspaceProjectRecordV2): RecentWorkspaceEntry[] {
  if (!record.lastKnownRootPath) {
    throw new Error("Workspace registry entry requires rootPath from the selected workspace");
  }

  const rootPath = path.resolve(record.lastKnownRootPath);
  const nextEntry = normalizeRecentWorkspaceEntry({
    id: record.id,
    name: record.name,
    rootPath,
    lastOpenedAt: Date.now(),
    missing: !fs.existsSync(rootPath),
  });
  const entries = listRecentWorkspaces(settingsRoot).filter((entry) => entry.id !== record.id);
  const next = sortRecentWorkspaces([nextEntry, ...entries]);
  writeRecentWorkspaces(settingsRoot, next);
  return next;
}

export function removeWorkspaceReference(settingsRoot: string, projectId: string): RecentWorkspaceEntry[] {
  const next = listRecentWorkspaces(settingsRoot).filter((entry) => entry.id !== projectId);
  writeRecentWorkspaces(settingsRoot, next);
  return next;
}
