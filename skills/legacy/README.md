# Legacy Skills (Archived)

The skills in this directory originated in the early **tapcanvas** project and
predate Nomi's Skill Pack v2 format defined in `electron/skills/skillManifestSchema.ts`.

**They are archived and intentionally not loaded by the runtime.**
The skill loader (`electron/runtime.ts → readSkillRecords`) explicitly skips
the `skills/legacy/` directory, so these `SKILL.md` files cannot be selected
from the UI and the model will never receive them as a system prompt.

## Why they are kept

- Historical reference for prompt-engineering ideas worth porting
- Source material for re-writing into Skill Pack v2 manifests in future releases
- Audit trail showing what the agent looked like before the v0.4.0 migration

## What's archived (23 packs, 2026-05-23)

| Pack | Origin |
|------|--------|
| `tapcanvas-api` | tapcanvas API integration playbook |
| `tapcanvas-collage-local` | Local collage workflow |
| `tapcanvas-continuity` | Multi-shot continuity tips |
| `tapcanvas-demo-patterns` | Demo storytelling patterns |
| `tapcanvas-design-to-web` | Design → web export flow |
| `tapcanvas-model-integration` | Provider integration recipes |
| `tapcanvas-prompt-specialists` | Specialized prompt writers |
| `tapcanvas-public-chat` | Public chat persona |
| `tapcanvas-replicate` | Replicate-specific helpers |
| `tapcanvas-storyboard-expert` | Replaced by `workbench-storyboard-planner` |
| `tapcanvas-video-prompting` | Video prompt patterns |
| `tapcanvas-visual-focus` | Visual focus guidance |
| `tapcanvas-workflow-orchestrator` | Workflow orchestration |
| `storyboard-gen` | Earliest storyboard generator, superseded by `workbench-storyboard-planner` |
| `agents-team` | Multi-agent team playbook (deprecated) |
| `agents-team-book-metadata` | Book metadata sub-skill (deprecated) |
| `canvas-workflow` | Pre-tool-calling canvas workflow |
| `timeline-edit` | Pre-Phase-B timeline edit skill |
| `long-running-app-harness` | CLI app harness, no longer relevant |
| `skill-installer` | Old skill installer helper |
| `code-review` | Generic code-review prompt |
| `generate-media` | Pre-tool-calling media generation prompt |
| `agent-builder` | Skill-authoring meta prompt |

## Upgrading a legacy pack

To resurrect one of these:

1. Move the directory back out of `skills/legacy/`.
2. Rewrite `SKILL.md` to remove any references to deprecated XML tag
   protocols (e.g. `<generation_canvas_plan>`).
3. Add a `skill.json` matching the schema in
   `electron/skills/skillManifestSchema.ts`.
4. Validate via the loader by selecting it from the workbench UI.

See `docs/skill-pack-format.md` for the v2 format spec.
