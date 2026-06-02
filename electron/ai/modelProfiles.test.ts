import { describe, expect, it } from "vitest";
import { applyProfileToRequestBody, getModelProfile } from "./modelProfiles";

describe("modelProfiles.getModelProfile", () => {
  it("matches OpenAI reasoning models", () => {
    expect(getModelProfile("o1-preview").requireTemperature).toBe(1);
    expect(getModelProfile("o3-mini").requireTemperature).toBe(1);
  });

  it("matches GPT-4o / GPT-5 family", () => {
    expect(getModelProfile("gpt-4o").agentSuitability).toBe("good");
    expect(getModelProfile("gpt-5").agentSuitability).toBe("good");
  });

  it("matches Anthropic Claude", () => {
    expect(getModelProfile("claude-3-7-sonnet-20250109").agentSuitability).toBe("good");
  });

  it("matches Gemini", () => {
    expect(getModelProfile("gemini-2.5-pro").agentSuitability).toBe("good");
    expect(getModelProfile("models/gemini-3-pro").agentSuitability).toBe("good");
  });

  it("flags Kimi K2 as poor + sets quirks", () => {
    const p = getModelProfile("kimi-k2.6");
    expect(p.agentSuitability).toBe("poor");
    expect(p.requireTemperature).toBe(1);
    expect(p.extraBody?.enable_thinking).toBe(false);
    expect(p.requiresReasoningContentRoundtrip).toBe(true);
  });

  it("flags Moonshot v1 as poor + sets tool reliability flag", () => {
    const p = getModelProfile("moonshot-v1-128k");
    expect(p.agentSuitability).toBe("poor");
    expect(p.unreliableToolJson).toBe(true);
  });

  it("falls back to acceptable for unknown models", () => {
    const p = getModelProfile("some-new-model");
    expect(p.agentSuitability).toBe("acceptable");
    expect(p.defaultMaxTokens).toBe(4096);
  });
});

describe("modelProfiles.applyProfileToRequestBody", () => {
  it("applies fixed temperature", () => {
    const body = { temperature: 0.5, messages: [] };
    const profile = { requireTemperature: 1 };
    expect(applyProfileToRequestBody(body, profile)).toMatchObject({ temperature: 1 });
  });

  it("does not override caller-set max_tokens", () => {
    const body = { max_tokens: 8000 };
    const profile = { defaultMaxTokens: 4096 };
    expect(applyProfileToRequestBody(body, profile).max_tokens).toBe(8000);
  });

  it("sets default max_tokens when caller didn't", () => {
    const body = {};
    const profile = { defaultMaxTokens: 4096 };
    expect(applyProfileToRequestBody(body, profile).max_tokens).toBe(4096);
  });

  it("merges extraBody", () => {
    const body = { messages: [] };
    const profile = { extraBody: { enable_thinking: false } };
    expect(applyProfileToRequestBody(body, profile)).toMatchObject({
      messages: [],
      enable_thinking: false,
    });
  });

  it("does not mutate input body", () => {
    const body = { temperature: 0.5 };
    const profile = { requireTemperature: 1 };
    applyProfileToRequestBody(body, profile);
    expect(body.temperature).toBe(0.5);
  });
});
