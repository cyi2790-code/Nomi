import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, deleteProject, listProjects, readProject, resolveProjectRelativePath, saveProject } from "./runtime";
import { workspaceProjectFile } from "./workspace/workspacePaths";

const tempRoots: string[] = [];
let mockedDocumentsRoot = "";
let mockedUserDataRoot = "";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "documents") return mockedDocumentsRoot;
      if (name === "userData") return mockedUserDataRoot;
      return mockedUserDataRoot;
    },
    getAppPath: () => process.cwd(),
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));
  mockedDocumentsRoot = makeTempDir("nomi-runtime-documents-");
  mockedUserDataRoot = makeTempDir("nomi-runtime-user-data-");
  delete process.env.NOMI_PROJECTS_DIR;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.NOMI_PROJECTS_DIR;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(name = "nomi-runtime-workspace-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

describe("runtime workspace project APIs", () => {
  it("createProject accepts rootPath and writes .nomi/project.json", () => {
    const workspaceRoot = makeTempDir();

    const created = createProject({ rootPath: workspaceRoot, name: "Runtime Workspace", payload: { scenes: [] } });

    expect(created).toMatchObject({
      name: "Runtime Workspace",
      version: 2,
      payload: { scenes: [] },
    });
    expect(fs.existsSync(workspaceProjectFile(workspaceRoot))).toBe(true);
    expect(listProjects()[0]).toMatchObject({ id: created.id, name: "Runtime Workspace", missing: false });
  });

  it("readProject finds a workspace project outside the default projects root", () => {
    const defaultRoot = path.join(mockedDocumentsRoot, "Nomi Projects");
    const workspaceRoot = makeTempDir();

    const created = createProject({ rootPath: workspaceRoot, name: "Outside Default", payload: { script: "hello" } });

    expect(workspaceRoot.startsWith(defaultRoot)).toBe(false);
    expect(readProject(created.id)).toEqual(created);
  });

  it("localizes embedded data media URLs before parsing a workspace manifest", () => {
    const workspaceRoot = makeTempDir();
    const created = createProject({ rootPath: workspaceRoot, name: "Slim Embedded", payload: {} });
    const manifestPath = workspaceProjectFile(workspaceRoot);
    const dataUrl = "data:image/png;base64,aGVsbG8=";
    const bloated = {
      ...created,
      payload: {
        generationCanvas: {
          nodes: [
            {
              id: "node-1",
              result: {
                id: "result-1",
                type: "image",
                url: dataUrl,
                createdAt: 1,
              },
            },
          ],
          edges: [],
          selectedNodeIds: [],
          groups: [],
        },
      },
    };
    fs.writeFileSync(manifestPath, JSON.stringify(bloated), "utf8");

    const read = readProject(created.id) as typeof bloated;
    const rawAfterRead = fs.readFileSync(manifestPath, "utf8");
    const localizedUrl = read.payload.generationCanvas.nodes[0].result.url;

    expect(localizedUrl).toMatch(/^nomi-local:\/\/asset\//);
    expect(rawAfterRead).not.toContain(dataUrl);
    expect(rawAfterRead).toContain("nomi-local://asset/");
    expect(fs.readdirSync(path.join(workspaceRoot, "assets", "generated", "2026-05-31"))).toHaveLength(1);
  });

  it("saveProject updates workspace manifest payload", () => {
    const workspaceRoot = makeTempDir();
    const created = createProject({ rootPath: workspaceRoot, name: "Save Runtime", payload: { draft: 1 } });
    vi.setSystemTime(new Date("2026-05-31T12:30:00Z"));

    const saved = saveProject(created.id, { name: "Saved Runtime", payload: { draft: 2 } });
    const raw = JSON.parse(fs.readFileSync(workspaceProjectFile(workspaceRoot), "utf8"));

    expect(saved).toMatchObject({
      id: created.id,
      name: "Saved Runtime",
      updatedAt: Date.parse("2026-05-31T12:30:00Z"),
      savedAt: Date.parse("2026-05-31T12:30:00Z"),
      revision: (created.revision ?? 0) + 1,
      payload: { draft: 2 },
    });
    expect(raw.payload).toEqual({ draft: 2 });
  });

  it("deleteProject only removes the recent workspace reference", () => {
    const workspaceRoot = makeTempDir();
    const created = createProject({ rootPath: workspaceRoot, name: "Remove Reference", payload: {} });

    const result = deleteProject(created.id);

    expect(result).toEqual({ id: created.id, deleted: false });
    expect(readProject(created.id)).toBeNull();
    expect(fs.existsSync(workspaceProjectFile(workspaceRoot))).toBe(true);
  });

  it("listProjects migrates legacy projects from the default projects root into the workspace registry", () => {
    const defaultRoot = path.join(mockedDocumentsRoot, "Nomi Projects");
    const legacyRoot = path.join(defaultRoot, "Legacy Project");
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(
      path.join(legacyRoot, "project.json"),
      JSON.stringify({
        id: "legacy-id",
        name: "Legacy Project",
        version: 1,
        createdAt: 100,
        updatedAt: 200,
        savedAt: 300,
        revision: 2,
        payload: { old: true },
      }),
    );

    const projects = listProjects();

    expect(projects).toEqual([expect.objectContaining({ id: "legacy-id", name: "Legacy Project", version: 2 })]);
    expect(fs.existsSync(workspaceProjectFile(legacyRoot))).toBe(false);
    expect(readProject("legacy-id")?.payload).toEqual({ old: true });
    expect(fs.existsSync(workspaceProjectFile(legacyRoot))).toBe(true);
  });

  it("defers legacy payload migration from listProjects until readProject", () => {
    const defaultRoot = path.join(mockedDocumentsRoot, "Nomi Projects");
    const legacyRoot = path.join(defaultRoot, "Bloated Legacy");
    const dataUrl = "data:image/png;base64,aGVsbG8=";
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(
      path.join(legacyRoot, "project.json"),
      JSON.stringify({
        id: "bloated-legacy-id",
        name: "Bloated Legacy",
        version: 1,
        createdAt: 100,
        updatedAt: 200,
        savedAt: 300,
        revision: 2,
        payload: { image: dataUrl },
      }),
    );

    expect(listProjects()).toEqual([expect.objectContaining({ id: "bloated-legacy-id", name: "Bloated Legacy" })]);
    expect(fs.existsSync(workspaceProjectFile(legacyRoot))).toBe(false);
    expect(fs.existsSync(path.join(legacyRoot, "assets", "generated"))).toBe(false);

    const read = readProject("bloated-legacy-id") as { payload: { image: string } } | null;
    const rawLegacyAfterRead = fs.readFileSync(path.join(legacyRoot, "project.json"), "utf8");
    const rawManifestAfterRead = fs.readFileSync(workspaceProjectFile(legacyRoot), "utf8");

    expect(read?.payload.image).toMatch(/^nomi-local:\/\/asset\//);
    expect(rawLegacyAfterRead).not.toContain(dataUrl);
    expect(rawManifestAfterRead).not.toContain(dataUrl);
    expect(rawManifestAfterRead).toContain("nomi-local://asset/");
    expect(fs.readdirSync(path.join(legacyRoot, "assets", "generated", "2026-05-31"))).toHaveLength(1);
  });

  it("resolveProjectRelativePath rejects symlink escapes from a workspace project", () => {
    const workspaceRoot = makeTempDir();
    const outsideRoot = makeTempDir("nomi-runtime-outside-");
    const created = createProject({ rootPath: workspaceRoot, name: "Symlink Runtime", payload: {} });
    fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "secret");
    fs.symlinkSync(outsideRoot, path.join(workspaceRoot, "linked-outside"), "dir");

    expect(() => resolveProjectRelativePath(created.id, "linked-outside/secret.txt")).toThrow(/inside the selected workspace|escapes project root/i);
  });

  it("deleteProject does not make migrated legacy projects reappear on the next list", () => {
    const defaultRoot = path.join(mockedDocumentsRoot, "Nomi Projects");
    const legacyRoot = path.join(defaultRoot, "Deleted Legacy");
    fs.mkdirSync(legacyRoot, { recursive: true });
    fs.writeFileSync(
      path.join(legacyRoot, "project.json"),
      JSON.stringify({ id: "delete-legacy-id", name: "Deleted Legacy", version: 1, payload: {} }),
    );
    expect(listProjects()).toEqual([expect.objectContaining({ id: "delete-legacy-id" })]);

    expect(deleteProject("delete-legacy-id")).toEqual({ id: "delete-legacy-id", deleted: false });

    expect(fs.existsSync(legacyRoot)).toBe(true);
    expect(listProjects()).toEqual([]);
    expect(readProject("delete-legacy-id")).toBeNull();
  });

  it("does not create new desktop projects directly under the default projects root without a rootPath", () => {
    expect(() => createProject({ name: "No Folder", payload: {} })).toThrow(/rootPath/);
    expect(fs.existsSync(path.join(mockedDocumentsRoot, "Nomi Projects"))).toBe(false);
  });

  it("does not create new fixed-root projects when saving an unknown project id", () => {
    expect(() => saveProject("missing-id", { name: "Missing", payload: {} })).toThrow(/workspace project/i);
    expect(listProjects()).toEqual([]);
  });
});
