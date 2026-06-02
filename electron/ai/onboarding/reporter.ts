/**
 * Trial reporter — writes trace.json + summary.md for each trial run.
 *
 * Output layout: <trialsRoot>/<timestamp>-<slug>/
 *   - trace.json        Full event log + draft state + token usage
 *   - summary.md        Human-readable: status, time, cost, fields found, what failed
 *   - final-mapping.json The catalog draft (vendor + model + mapping), even on failure
 */
import fs from "node:fs";
import path from "node:path";
import type { TrialEvent, TrialOutcome, ModelKind } from "./types";

export type Reporter = {
  trialDir: string;
  onEvent: (event: TrialEvent) => void;
  finalize: (outcome: TrialOutcome) => void;
};

export function createReporter(opts: {
  trialsRoot: string;
  trialId: string;
  docsUrl: string;
  targetKind: ModelKind;
}): Reporter {
  const slug = trialSlug(opts.docsUrl);
  const trialDir = path.join(opts.trialsRoot, `${opts.trialId}-${slug}`);
  fs.mkdirSync(trialDir, { recursive: true });

  const events: TrialEvent[] = [];

  return {
    trialDir,
    onEvent: (event) => {
      events.push(event);
      // also write incrementally so a crashed run still has data
      try {
        fs.writeFileSync(path.join(trialDir, "trace.json"), JSON.stringify(events, null, 2));
      } catch {
        /* ignore — best effort */
      }
    },
    finalize: (outcome) => {
      fs.writeFileSync(path.join(trialDir, "trace.json"), JSON.stringify(events, null, 2));
      fs.writeFileSync(path.join(trialDir, "final-mapping.json"), JSON.stringify(buildFinalMapping(outcome), null, 2));
      fs.writeFileSync(path.join(trialDir, "summary.md"), buildSummary(outcome));
    },
  };
}

function trialSlug(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const pathSlug = u.pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 30);
    return `${host}-${pathSlug || "root"}`;
  } catch {
    return "unknown";
  }
}

function buildFinalMapping(outcome: TrialOutcome) {
  const d = outcome.draft;
  return {
    vendor: {
      key: d.vendorKey,
      name: d.vendorName,
      baseUrl: d.vendorBaseUrl,
      auth: d.vendorAuth,
      providerKind: d.vendorProviderKind,
    },
    model: {
      key: d.modelKey,
      displayName: d.modelDisplayName,
      kind: d.targetKind,
      fields: d.modelFields,
    },
    mapping: {
      create: d.mappingCreate,
      query: d.mappingQuery,
    },
    completenessCheck: d.completenessCheck,
  };
}

function buildSummary(outcome: TrialOutcome): string {
  const d = outcome.draft;
  const seconds = (outcome.durationMs / 1000).toFixed(1);
  const cost = estimateCost(outcome.tokenUsage.totalTokens, outcome.agentModel);

  const lines: string[] = [];
  lines.push(`# Trial ${outcome.trialId}`);
  lines.push("");
  lines.push(`- **Status**: ${statusEmoji(outcome.status)} ${outcome.status.toUpperCase()}`);
  if (outcome.failureReason) lines.push(`- **Reason**: ${outcome.failureReason}`);
  lines.push(`- **Docs**: ${outcome.docsUrl}`);
  lines.push(`- **Kind**: ${outcome.targetKind}`);
  lines.push(`- **Agent**: ${outcome.agentModel}`);
  lines.push(`- **Time**: ${seconds}s`);
  lines.push(`- **Rounds**: ${outcome.rounds} LLM steps, ${outcome.toolCalls} tool calls`);
  lines.push(`- **Tokens**: ${outcome.tokenUsage.totalTokens.toLocaleString()} (prompt ${outcome.tokenUsage.promptTokens.toLocaleString()} + completion ${outcome.tokenUsage.completionTokens.toLocaleString()})`);
  lines.push(`- **Est. cost**: ${cost}`);
  lines.push("");

  lines.push("## Vendor");
  lines.push(`- Key: \`${d.vendorKey || "(not set)"}\``);
  lines.push(`- Base URL: \`${d.vendorBaseUrl || "(not set)"}\``);
  lines.push(`- Auth: ${d.vendorAuth ? JSON.stringify(d.vendorAuth) : "(not set)"}`);
  lines.push("");

  lines.push("## Model");
  lines.push(`- Key: \`${d.modelKey || "(not set)"}\``);
  lines.push(`- Display: ${d.modelDisplayName || "(not set)"}`);
  lines.push(`- Fields extracted: ${d.modelFields.length}`);
  if (d.modelFields.length > 0) {
    lines.push("");
    lines.push("| Field | Type | Confidence | Evidence location |");
    lines.push("|---|---|---|---|");
    for (const f of d.modelFields) {
      lines.push(`| \`${f.key}\` | ${f.type} | ${f.evidence.confidence} | ${f.evidence.evidence_location} |`);
    }
  }
  lines.push("");

  if (d.completenessCheck) {
    lines.push("## Completeness check");
    const c = d.completenessCheck;
    const has = c.items.filter((i) => i.status === "has").length;
    const no = c.items.filter((i) => i.status === "no").length;
    const unsure = c.items.filter((i) => i.status === "unsure").length;
    lines.push(`- has: ${has} / no: ${no} / unsure: ${unsure}`);
    if (unsure > 0) {
      lines.push("- ⚠️ unsure items:");
      for (const item of c.items.filter((i) => i.status === "unsure")) {
        lines.push(`  - \`${item.field}\`: ${item.reasoning}`);
      }
    }
    lines.push("");
  }

  lines.push("## Test attempts");
  if (d.testAttempts.length === 0) {
    lines.push("- (none — agent never tested the mapping)");
  } else {
    for (const [i, t] of d.testAttempts.entries()) {
      lines.push(`### Attempt ${i + 1} (${t.stage})`);
      lines.push(`- ${t.ok ? "✅" : "❌"} HTTP ${t.response.status}`);
      lines.push(`- ${t.request.method} ${t.request.url}`);
      lines.push(`- diagnostics: ${t.diagnostics.join(" / ") || "(none)"}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function statusEmoji(status: TrialOutcome["status"]): string {
  switch (status) {
    case "success": return "✅";
    case "partial": return "⚠️";
    case "failure": return "❌";
  }
}

/**
 * Rough cost estimate per million tokens.
 * Update when model pricing changes — these are January 2026 ballpark.
 */
const COST_PER_M_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-5": { input: 5.0, output: 15.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "claude-3-7-sonnet": { input: 3.0, output: 15.0 },
  "claude-4-opus": { input: 15.0, output: 75.0 },
  "claude-4-sonnet": { input: 3.0, output: 15.0 },
  "gemini-3-pro": { input: 1.25, output: 5.0 },
};

function estimateCost(totalTokens: number, modelId: string): string {
  // Match prefix
  const key = Object.keys(COST_PER_M_TOKENS).find((k) => modelId.toLowerCase().includes(k.replace("-", "")));
  if (!key) return `~$? (${modelId} pricing unknown)`;
  const rate = COST_PER_M_TOKENS[key];
  const avg = (rate.input + rate.output) / 2;
  const cost = (totalTokens / 1_000_000) * avg;
  return `~$${cost.toFixed(4)} (${modelId})`;
}
