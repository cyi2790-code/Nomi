/**
 * AI SDK model factory.
 *
 * Returns a Vercel AI SDK `LanguageModelV1` for either an OpenAI-compatible
 * endpoint (most providers) or the Anthropic Messages API.
 *
 * Provider-specific quirks (Moonshot's `enable_thinking`, reasoning models'
 * fixed temperature, max_tokens defaults) are NOT hardcoded here — they
 * live in `modelProfiles.ts` as data. This module just plumbs the profile
 * through a wrapping fetch.
 *
 * Adding a new quirky provider = adding one entry to modelProfiles, not
 * editing this file.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV1 } from "ai";
import { applyProfileToRequestBody, getModelProfile } from "./modelProfiles";

export type AiSdkProviderKind = "openai-compatible" | "anthropic";

export interface BuildAiSdkModelInput {
  kind: AiSdkProviderKind;
  baseURL: string;
  apiKey: string;
  modelId: string;
}

/**
 * Wrap the global fetch so each request body gets profile-driven adjustments
 * (forced temperature, default max_tokens, extra body fields).
 *
 * Optional debug: set LAB_DEBUG_REQUESTS=1 to dump each request body to /tmp.
 */
function buildProfiledFetch(modelId: string): typeof fetch {
  const profile = getModelProfile(modelId);
  const debug = process.env.LAB_DEBUG_REQUESTS === "1";

  return (async (url: any, init?: any) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        const adjusted = applyProfileToRequestBody(body, profile);
        if (debug) {
          const fs = await import("node:fs");
          fs.writeFileSync(
            `/tmp/lab-request-${Date.now()}.json`,
            JSON.stringify(adjusted, null, 2),
          );
        }
        init = { ...init, body: JSON.stringify(adjusted) };
      } catch {
        /* body is not JSON — pass through unchanged */
      }
    }
    return fetch(url as any, init);
  }) as typeof fetch;
}

export function buildAiSdkModel(input: BuildAiSdkModelInput): LanguageModelV1 {
  const apiKey = (input.apiKey || "").trim();
  if (!apiKey) {
    throw new Error("buildAiSdkModel: apiKey is required");
  }
  const modelId = (input.modelId || "").trim();
  if (!modelId) {
    throw new Error("buildAiSdkModel: modelId is required");
  }
  const baseURL = (input.baseURL || "").trim().replace(/\/+$/, "");

  if (input.kind === "anthropic") {
    const provider = createAnthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
    return provider.languageModel(modelId);
  }

  if (!baseURL) {
    throw new Error("buildAiSdkModel: baseURL is required for openai-compatible providers");
  }
  const provider = createOpenAICompatible({
    name: "nomi",
    baseURL,
    apiKey,
    fetch: buildProfiledFetch(modelId),
  });
  return provider.chatModel(modelId);
}

// Re-export profile lookup for the onboarding wizard's capability test.
export { getModelProfile } from "./modelProfiles";
