import { z } from "zod";

/**
 * Skill Pack v2 manifest schema.
 *
 * A Skill Pack is a directory under `skills/<name>/` that contains:
 *   - `SKILL.md`     : pure knowledge / domain methodology (system prompt body)
 *   - `skill.json`   : machine-readable manifest validated by this schema
 *
 * The runtime loader prefers `skill.json` to derive tool whitelists and provider
 * requirements; if absent, the loader falls back to reading `SKILL.md` only
 * (legacy behavior, preserved for back-compat).
 *
 * See `docs/skill-pack-format.md` for the human-facing spec.
 */

export const skillProviderKindSchema = z.enum(["text", "image", "video"]);
export type SkillProviderKind = z.infer<typeof skillProviderKindSchema>;

export const skillPermissionSchema = z.enum([
  "read-only",
  "create",
  "delete",
  "export",
]);
export type SkillPermission = z.infer<typeof skillPermissionSchema>;

export const skillInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean().optional(),
});
export type SkillInput = z.infer<typeof skillInputSchema>;

export const skillExampleSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  input: z.string().optional(),
});
export type SkillExample = z.infer<typeof skillExampleSchema>;

export const skillManifestSchema = z.object({
  /** Stable identifier (e.g. `workbench.storyboard.planner`). */
  name: z.string().min(1),
  /** Semver-ish string, e.g. `1.0.0`. */
  version: z.string().min(1),
  /** One-line human-readable summary shown in the UI. */
  description: z.string().min(1),
  /** Tool whitelist — only these tool names may be exposed to the LLM. */
  tools: z.array(z.string().min(1)),
  /** Provider modalities required to run this skill end-to-end. */
  requiredProviders: z.array(skillProviderKindSchema),
  /** Capability gates the user grants when loading the skill. */
  permissions: z.array(skillPermissionSchema),
  /** Declared inputs the caller is expected to supply (optional). */
  inputs: z.array(skillInputSchema).optional(),
  /** Sample prompts shown in onboarding or the skill picker (optional). */
  examples: z.array(skillExampleSchema).optional(),
});
export type SkillManifest = z.infer<typeof skillManifestSchema>;

/**
 * Parse and validate raw JSON into a SkillManifest, returning a discriminated
 * result. Callers should treat any failure as "manifest absent" and fall back
 * to markdown-only loading; we intentionally do not throw because skill loads
 * happen on the hot path of every chat turn.
 */
export function parseSkillManifest(input: unknown):
  | { ok: true; manifest: SkillManifest }
  | { ok: false; error: string } {
  const parsed = skillManifestSchema.safeParse(input);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}
