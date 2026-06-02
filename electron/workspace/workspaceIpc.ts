import path from "node:path";
import { hasWorkspaceManifest } from "./workspaceManifest";

export type WorkspaceFolderSelection = { canceled: true } | { canceled: false; rootPath: string };

type WorkspaceFolderDialogProperty = "openDirectory" | "createDirectory";

export type WorkspaceFolderDialog = {
  showOpenDialog: (options: { properties: WorkspaceFolderDialogProperty[]; title?: string; buttonLabel?: string }) => Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;
};

type WorkspaceProjectCreator = (record: unknown) => unknown;

export type WorkspaceOpenFolderPayload = {
  rootPath: string;
  initialize?: boolean;
  name?: string;
};

export type WorkspaceOpenFolderDeps = {
  createProject: WorkspaceProjectCreator;
  selectedRootPaths?: ReadonlySet<string>;
  confirmInitialize?: (rootPath: string) => Promise<boolean> | boolean;
};

export async function selectWorkspaceFolder(dialog: WorkspaceFolderDialog): Promise<WorkspaceFolderSelection> {
  const result = await dialog.showOpenDialog({
    title: "选择 Nomi 项目文件夹",
    buttonLabel: "打开文件夹",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }
  return { canceled: false, rootPath: path.resolve(result.filePaths[0]) };
}

export async function openWorkspaceFolder(payload: WorkspaceOpenFolderPayload, deps: WorkspaceOpenFolderDeps): Promise<unknown> {
  const rawRootPath = String(payload.rootPath || "").trim();
  if (!rawRootPath) {
    throw new Error("rootPath is required");
  }
  const rootPath = path.resolve(rawRootPath);
  if (deps.selectedRootPaths && !deps.selectedRootPaths.has(rootPath)) {
    throw new Error("Workspace folder must be selected with native picker first");
  }

  const hasManifest = hasWorkspaceManifest(rootPath);
  if (!hasManifest && !payload.initialize) {
    throw new Error("Workspace folder is not initialized");
  }
  if (!hasManifest && payload.initialize) {
    const confirmed = await deps.confirmInitialize?.(rootPath);
    if (!confirmed) {
      throw new Error("Workspace initialization canceled");
    }
  }

  const record = payload.name ? { rootPath, name: payload.name } : { rootPath };
  return deps.createProject(record);
}
