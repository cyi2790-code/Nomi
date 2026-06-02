/**
 * Tests for the async-API enforcement that PR2 added: a create endpoint that
 * returns a task id without an asset URL must have a working query stage before
 * it can be committed. Otherwise the model lands in the catalog "passing" but
 * never actually returns an image/video.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DraftStore, looksAsyncResponse } from "./draft";
import type { RequestProfileOperation } from "./types";

describe("looksAsyncResponse", () => {
  it("flags kie.ai task-id shape (code/data.taskId, no asset)", () => {
    expect(looksAsyncResponse({ code: 200, data: { taskId: "abc-123" } })).toBe(true);
  });

  it("flags top-level task_id / jobId / id", () => {
    expect(looksAsyncResponse({ task_id: "t1" })).toBe(true);
    expect(looksAsyncResponse({ jobId: "j1" })).toBe(true);
    expect(looksAsyncResponse({ id: "x1" })).toBe(true);
  });

  it("treats a task id WITH an asset url as sync (asset present)", () => {
    expect(looksAsyncResponse({ id: "x1", image_url: "https://e/i.png" })).toBe(false);
    expect(looksAsyncResponse({ data: { taskId: "t", resultUrls: ["https://e/x"] } })).toBe(false);
  });

  it("treats OpenAI images sync shape as sync", () => {
    expect(looksAsyncResponse({ data: [{ url: "https://e/i.png" }] })).toBe(false);
    expect(looksAsyncResponse({ b64_json: "...." })).toBe(false);
  });

  it("ignores non-objects and asset-less, id-less payloads", () => {
    expect(looksAsyncResponse(null)).toBe(false);
    expect(looksAsyncResponse("string")).toBe(false);
    expect(looksAsyncResponse({ message: "ok" })).toBe(false);
  });
});

describe("DraftStore.validateForCommit — async gating", () => {
  let store: DraftStore;
  const sid = "s1";

  const createOp: RequestProfileOperation = { method: "POST", path: "/api/v1/create", body: {} };
  const queryOp: RequestProfileOperation = { method: "GET", path: "/api/v1/query" };

  const seedMinimalSyncDraft = () => {
    store.patch(sid, {
      vendorKey: "kie",
      vendorBaseUrl: "https://api.kie.ai",
      vendorAuth: { type: "bearer" },
      modelKey: "m1",
    });
    store.upsertField(sid, {
      key: "prompt",
      displayName: "Prompt",
      type: "text",
      evidence: { field: "prompt", evidence: "the prompt to generate from", evidence_location: "body", confidence: "high" },
    });
    store.setMapping(sid, "create", createOp);
  };

  const addCreateTest = (ok: boolean, body: unknown) => {
    store.appendTestAttempt(sid, {
      timestamp: Date.now(),
      stage: "create",
      request: { method: "POST", url: "https://api.kie.ai/api/v1/create", headers: {}, body: {} },
      response: { status: 200, body },
      ok,
      diagnostics: [],
    });
  };

  const addQueryTest = (ok: boolean) => {
    store.appendTestAttempt(sid, {
      timestamp: Date.now(),
      stage: "query",
      request: { method: "GET", url: "https://api.kie.ai/api/v1/query", headers: {}, body: null },
      response: { status: 200, body: { data: { status: "succeeded" } } },
      ok,
      diagnostics: [],
    });
  };

  beforeEach(() => {
    store = new DraftStore();
    store.create(sid, "image");
  });

  it("passes a sync model with a successful create test", () => {
    seedMinimalSyncDraft();
    addCreateTest(true, { data: [{ url: "https://e/i.png" }] });
    expect(store.validateForCommit(sid)).toBeNull();
  });

  it("blocks an async model that has no query stage", () => {
    seedMinimalSyncDraft();
    addCreateTest(true, { code: 200, data: { taskId: "t-1" } });
    const missing = store.validateForCommit(sid);
    expect(missing).not.toBeNull();
    expect(missing!.some((m) => m.includes("mapping.query"))).toBe(true);
  });

  it("blocks an async model with a query stage but no query test", () => {
    seedMinimalSyncDraft();
    store.setMapping(sid, "query", queryOp);
    addCreateTest(true, { code: 200, data: { taskId: "t-1" } });
    const missing = store.validateForCommit(sid);
    expect(missing!.some((m) => m.includes("no query test"))).toBe(true);
  });

  it("blocks an async model whose query test failed", () => {
    seedMinimalSyncDraft();
    store.setMapping(sid, "query", queryOp);
    addCreateTest(true, { code: 200, data: { taskId: "t-1" } });
    addQueryTest(false);
    const missing = store.validateForCommit(sid);
    expect(missing!.some((m) => m.includes("query test failed"))).toBe(true);
  });

  it("passes an async model with query stage + successful query test", () => {
    seedMinimalSyncDraft();
    store.setMapping(sid, "query", queryOp);
    addCreateTest(true, { code: 200, data: { taskId: "t-1" } });
    addQueryTest(true);
    expect(store.validateForCommit(sid)).toBeNull();
  });

  it("reports the missing pieces of an empty draft", () => {
    const missing = store.validateForCommit(sid);
    expect(missing).not.toBeNull();
    expect(missing!).toEqual(
      expect.arrayContaining(["vendor.key", "vendor.baseUrl", "vendor.auth", "model.key", "mapping.create"]),
    );
  });
});
