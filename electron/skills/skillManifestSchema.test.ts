import { describe, expect, it } from "vitest";

import { parseSkillManifest, skillManifestSchema } from "./skillManifestSchema";

describe("skillManifestSchema", () => {
  it("accepts a minimal valid manifest", () => {
    const result = parseSkillManifest({
      name: "workbench.example",
      version: "1.0.0",
      description: "Example skill",
      tools: ["create_canvas_nodes"],
      requiredProviders: ["text"],
      permissions: ["create"],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts optional inputs and examples", () => {
    const result = parseSkillManifest({
      name: "workbench.example",
      version: "1.0.0",
      description: "Example skill",
      tools: ["create_canvas_nodes"],
      requiredProviders: ["text", "image"],
      permissions: ["read-only", "create"],
      inputs: [{ name: "story", description: "The story text", required: true }],
      examples: [{ title: "Demo", description: "demo case" }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unknown permission values", () => {
    const result = parseSkillManifest({
      name: "x",
      version: "1.0.0",
      description: "d",
      tools: [],
      requiredProviders: ["text"],
      permissions: ["god-mode"],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing required fields", () => {
    const parsed = skillManifestSchema.safeParse({ name: "x" });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty name string", () => {
    const result = parseSkillManifest({
      name: "",
      version: "1.0.0",
      description: "d",
      tools: [],
      requiredProviders: [],
      permissions: [],
    });
    expect(result.ok).toBe(false);
  });
});
