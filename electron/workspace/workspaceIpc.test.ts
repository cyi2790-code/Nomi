import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openWorkspaceFolder, selectWorkspaceFolder, type WorkspaceFolderDialog } from "./workspaceIpc";
import { workspaceProjectFile } from "./workspacePaths";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(name = "nomi-workspace-ipc-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

describe("workspace folder IPC helpers", () => {
  it("returns canceled=true when user cancels folder selection", async () => {
    const dialog: WorkspaceFolderDialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    };

    await expect(selectWorkspaceFolder(dialog)).resolves.toEqual({ canceled: true });
  });

  it("returns selected rootPath when user chooses one directory", async () => {
    const rootPath = makeTempDir();
    const dialog: WorkspaceFolderDialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [rootPath] })),
    };

    await expect(selectWorkspaceFolder(dialog)).resolves.toEqual({ canceled: false, rootPath: path.resolve(rootPath) });
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: expect.arrayContaining(["openDirectory"]) }));
  });

  it("opens existing workspace without reinitializing", async () => {
    const rootPath = makeTempDir();
    const existing = {
      id: "existing-id",
      name: "Existing Workspace",
      version: 2,
      createdAt: 100,
      updatedAt: 200,
      savedAt: 300,
      revision: 1,
      payload: { keep: true },
    };
    fs.mkdirSync(path.dirname(workspaceProjectFile(rootPath)), { recursive: true });
    fs.writeFileSync(workspaceProjectFile(rootPath), JSON.stringify(existing, null, 2));
    const createProject = vi.fn((payload: unknown) => ({ ...existing, ...(payload as object), id: existing.id, version: 2 }));

    await expect(openWorkspaceFolder({ rootPath }, { createProject })).resolves.toMatchObject({ id: "existing-id", name: "Existing Workspace", payload: { keep: true } });
    expect(createProject).toHaveBeenCalledWith({ rootPath: path.resolve(rootPath) });
  });

  it("initializes a workspace when requested and main process confirms", async () => {
    const rootPath = makeTempDir();
    const createProject = vi.fn((payload: unknown) => ({ id: "new-id", version: 2, name: "New Workspace", ...(payload as object) }));
    const confirmInitialize = vi.fn(async () => true);

    const opened = await openWorkspaceFolder({ rootPath, initialize: true, name: "New Workspace" }, { createProject, confirmInitialize });

    expect(confirmInitialize).toHaveBeenCalledWith(path.resolve(rootPath));
    expect(opened).toMatchObject({ id: "new-id", name: "New Workspace", rootPath: path.resolve(rootPath) });
    expect(createProject).toHaveBeenCalledWith({ rootPath: path.resolve(rootPath), name: "New Workspace" });
  });

  it("rejects initialization when main-process confirmation is canceled", async () => {
    const rootPath = makeTempDir();
    const createProject = vi.fn();
    const confirmInitialize = vi.fn(async () => false);

    await expect(openWorkspaceFolder({ rootPath, initialize: true }, { createProject, confirmInitialize })).rejects.toThrow(/canceled/i);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("rejects rootPath values that were not selected by the native picker", async () => {
    const rootPath = makeTempDir();
    const createProject = vi.fn();
    const selectedRootPaths = new Set<string>();

    await expect(openWorkspaceFolder({ rootPath, initialize: true }, { createProject, selectedRootPaths, confirmInitialize: vi.fn(async () => true) })).rejects.toThrow(/native picker/i);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("rejects empty rootPath instead of resolving to cwd", async () => {
    const createProject = vi.fn();

    await expect(openWorkspaceFolder({ rootPath: "", initialize: true }, { createProject, confirmInitialize: vi.fn(async () => true) })).rejects.toThrow(/rootPath is required/i);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("throws when opening an uninitialized folder without initialize=true", async () => {
    const rootPath = makeTempDir();
    const createProject = vi.fn();

    await expect(openWorkspaceFolder({ rootPath }, { createProject })).rejects.toThrow(/not initialized/i);
    expect(createProject).not.toHaveBeenCalled();
  });
});
