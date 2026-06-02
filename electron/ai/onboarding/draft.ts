/**
 * In-memory draft state for an onboarding session.
 *
 * One draft per active session. Atomic tools mutate the draft;
 * commit_model promotes draft to the real catalog.
 *
 * Lab mode: stays in memory, gets serialized into trace.json at end.
 * Phase B (user-facing): also written to disk under
 * `~/Library/Application Support/Nomi/onboarding-drafts/<sessionId>.json`
 * after each tool call, so half-finished sessions can resume.
 */
import type { OnboardingDraft, ModelKind, FieldDefinition, RequestProfileOperation } from "./types";

/**
 * Heuristic: does this response look like an async-job submission acknowledgement
 * (returns a task/job id without any asset url)? If yes, the API requires
 * polling — the draft needs a query stage before commit.
 *
 * Walks the response 2 levels deep looking for either a task-id-shaped key
 * (taskId, task_id, jobId, job_id, id) or an asset-url-shaped key
 * (image_url, video_url, audio_url, url, asset_url, resultUrls, results).
 * If we see the former without the latter, it's async.
 */
export function looksAsyncResponse(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const taskIdKeys = /^(task[_]?id|job[_]?id|id|recordId)$/i;
  const assetKeys = /^(image_url|video_url|audio_url|asset_url|url|result_?urls?|results|assets|images|videos|output|data_url|b64_json)$/i;
  let hasTaskId = false;
  let hasAsset = false;
  const walk = (node: unknown, depth: number): void => {
    if (depth < 0 || !node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (taskIdKeys.test(key) && (typeof value === "string" || typeof value === "number")) hasTaskId = true;
      if (assetKeys.test(key) && value != null) hasAsset = true;
      if (typeof value === "object") walk(value, depth - 1);
    }
  };
  walk(body, 3);
  return hasTaskId && !hasAsset;
}

export class DraftStore {
  private drafts = new Map<string, OnboardingDraft>();

  create(sessionId: string, targetKind: ModelKind): OnboardingDraft {
    const draft: OnboardingDraft = {
      sessionId,
      startedAt: Date.now(),
      targetKind,
      modelFields: [],
      fetchedDocs: [],
      testAttempts: [],
    };
    this.drafts.set(sessionId, draft);
    return draft;
  }

  get(sessionId: string): OnboardingDraft {
    const draft = this.drafts.get(sessionId);
    if (!draft) throw new Error(`Draft not found for session ${sessionId}`);
    return draft;
  }

  has(sessionId: string): boolean {
    return this.drafts.has(sessionId);
  }

  patch(sessionId: string, patch: Partial<OnboardingDraft>): OnboardingDraft {
    const current = this.get(sessionId);
    Object.assign(current, patch);
    return current;
  }

  upsertField(sessionId: string, field: FieldDefinition): FieldDefinition {
    const draft = this.get(sessionId);
    const idx = draft.modelFields.findIndex((f) => f.key === field.key);
    if (idx >= 0) {
      draft.modelFields[idx] = field;
    } else {
      draft.modelFields.push(field);
    }
    return field;
  }

  setMapping(sessionId: string, stage: "create" | "query", op: RequestProfileOperation): void {
    const draft = this.get(sessionId);
    if (stage === "create") {
      draft.mappingCreate = op;
    } else {
      draft.mappingQuery = op;
    }
  }

  appendFetchedDoc(sessionId: string, doc: OnboardingDraft["fetchedDocs"][number]): void {
    this.get(sessionId).fetchedDocs.push(doc);
  }

  appendTestAttempt(sessionId: string, attempt: OnboardingDraft["testAttempts"][number]): void {
    this.get(sessionId).testAttempts.push(attempt);
  }

  /**
   * Check if draft is "complete enough to commit" — all required pieces present.
   * Returns null if OK, or a list of missing items.
   *
   * Async-API enforcement: if the most recent create test returned a payload
   * that looks like a task-id without an asset URL (kie.ai style — every
   * createTask endpoint behaves this way), commit is blocked until a query
   * stage is defined AND a query test has succeeded. Without this, the model
   * lands in the catalog "passing tests" but never actually returns an image.
   */
  validateForCommit(sessionId: string): string[] | null {
    const draft = this.get(sessionId);
    const missing: string[] = [];
    if (!draft.vendorKey) missing.push("vendor.key");
    if (!draft.vendorBaseUrl) missing.push("vendor.baseUrl");
    if (!draft.vendorAuth) missing.push("vendor.auth");
    if (!draft.modelKey) missing.push("model.key");
    if (draft.modelFields.length === 0) missing.push("model.fields (empty)");
    if (!draft.mappingCreate) missing.push("mapping.create");

    const createTest = [...draft.testAttempts].reverse().find((t) => t.stage === "create");
    const queryTest = [...draft.testAttempts].reverse().find((t) => t.stage === "query");
    if (!createTest) missing.push("no create test attempts (must execute_test_curl at least once)");
    else if (!createTest.ok) missing.push(`last create test failed: ${createTest.diagnostics.join("; ")}`);

    if (createTest?.ok && looksAsyncResponse(createTest.response?.body)) {
      if (!draft.mappingQuery) {
        missing.push("mapping.query (create returned a task id with no asset URL — this is an async API; define a query stage)");
      }
      if (!queryTest) {
        missing.push("no query test attempts (async API requires execute_test_curl({stage:'query'}) to prove polling works)");
      } else if (!queryTest.ok) {
        missing.push(`last query test failed: ${queryTest.diagnostics.join("; ")}`);
      }
    }

    return missing.length > 0 ? missing : null;
  }

  delete(sessionId: string): void {
    this.drafts.delete(sessionId);
  }
}

// Singleton for the process. Lab CLI and IPC handler both import this.
export const draftStore = new DraftStore();
