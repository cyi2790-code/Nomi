# 拆镜头默认收敛:image-first + shot→shot 时序链(收口双真相源)

> 触发:`docs/audit/2026-06-14-eval-findings-handoff.md` 把 P1-A(不连边)/P1-B(出 video)当成「未拍板的产品决策 Q1/Q2」。
> 深挖后改判:**策略早已成文,坏的是「同一句拆镜头两条路径自相矛盾」**。用户已拍板(2026-06-15):
> **① 镜头默认建 `image`(先锁画面再动)；② 顺序叙事默认连 shot→shot 时序链。**
> 本文档定收敛范围 / 不动项 / 回滚 / 验收门,执行完回填。

## 0. 根因(症状/根因/入口集,P2)

eval `storyboard`(commit f05a9ac,pass@1=2/16)最一致的失败:`minChainEdges` 11/16、`kind` 7/16。
handoff 当作待拍板,实则是 bug,且**从两个入口冒出**:

| 入口 | 现象 | 根因(file:line) |
|---|---|---|
| **free-build**(生成区 AI 助手,eval 测的就是它) | 不连边/出 video | ① 两条默认(image / 连边)只写在 skill 层,**操作性工具说明 `create_canvas_nodes` 只字未提**(`generationCanvasAgentClient.ts:77`);② **两层提示自相矛盾**:SKILL.md 规则②让「调用 `connect_canvas_edges` 连相邻镜头」,静态硬约束(`generationCanvasAgentClient.ts:78,84`)却说「新计划的边必须放 create_canvas_nodes 的 edges 字段、不要拆两次调用」→ 模型两边都不敢做 → 不连边 |
| **plan 路径**(创作区「🎬 拆镜头」主链路,真实用户走的) | 每镜写死 video、只连 anchor→shot | `storyboardPlan.ts:260` 硬编码 `kind:'video'`;edges 只在 anchor→shot 间生成(`:267-271`),无 shot→shot 链 |

两条路径对「同一句拆镜头」给不同结果 = 真相源分裂(同 `connection-reference-bugs` 那类「多口径不收敛」)。
**收敛动作**:两条路径都按用户拍板的默认实现 + skill 与静态提示口径对齐。

注:plan 路径是 `docs/plan/2026-06-13-storyboard-plan-document-flow.md` 刻意设计的「anchor=定妆图卡 + shot=视频片段」。
用户拍板 image-first 即**推翻该主链路里 shot=video 的既定设计**,故本文档同步回填那份设计文档。

## 1. 范围

### Phase 1 — free-build 路径(eval 覆盖,低风险,直接灭 eval 红)
- **`src/workbench/generationCanvas/agent/generationCanvasAgentClient.ts`** `buildStaticAgentSystemPrompt`:
  在 `create_canvas_nodes` 工具说明 + 硬约束里**明写两条默认**:
  - 拆镜头默认 `kind=image`(关键画面先行);用户明说「视频/动起来/直接出视频」才 `video`。
  - 顺序叙事的相邻镜头默认在**同一次 create_canvas_nodes 的 `edges` 字段**里按时序连成 n1→n2→n3(`mode` 用 `reference`);用户明说「独立镜头/不要连线」才不连。
- **`skills/workbench-generation/SKILL.md`** 规则②:把「调用 `connect_canvas_edges` 连相邻镜头」改成「在 `create_canvas_nodes` 的 `edges` 字段里连」,消除与静态硬约束的矛盾(单一口径=边随节点一次提交)。

### Phase 2 — plan 路径主链路收敛(invasive,动到另一份设计文档)
- **`src/workbench/generationCanvas/agent/storyboardPlan.ts`** `storyboardPlanToCreateNodesArgs`:
  - 镜头节点 `kind:'video'` → `'image'`(`:260`)。
  - 镜头节点模型默认:停用 `defaultVideoModelKey/ModeId`,改用 `defaultImageModelKey/ModeId`(与 anchor 定妆卡同口径,GPT Image 2)。
  - **去掉镜头节点的 `duration` params**(image 节点无时长);`PlanShot.durationSec` 留在 IR 里(供日后 i2v 动画化用),不进 image 节点。
  - **新增 shot→shot 时序链边**:相邻镜头(按 `shot.index` 排序后)`reference` 连 n→n+1。anchor→shot 参考边保留不动。
  - 移除变死的 video 选项字段(`defaultVideoModelKey/defaultVideoModeId/maxDurationSec`)及其 JSDoc(P1 加新必删旧)。
- **`src/workbench/creation/storyboard/StoryboardPlanEditor.tsx`** `onConfirm`(`:74-87`):
  停止解析/传 `resolveStoryboardVideoDefault`(若它无其他调用方则一并删除,P1);只传 image 默认。
- **`src/workbench/generationCanvas/agent/storyboardPlan.test.ts`**:更新断言(镜头 kind=image、shot→shot 边数、模型默认换 image、删 maxDurationSec 用例)。
- **`docs/plan/2026-06-13-storyboard-plan-document-flow.md`**:回填「shot 由 video 改 image-first + shot→shot 链」的决策变更。

### eval/数据集
- `evals/datasets/storyboard.mjs` 的 `expect.kind="image"`、`minChainEdges` 已与新默认一致 → **不改**。
- `evals/lib/grading.mjs:84-90` kind「合理分歧」注释:用户已裁定强制 image → 注释更新为「已裁定 image-first」(逻辑不变,仍按数组白名单判)。

## 2. 不动什么

- `propose_storyboard_plan` 工具 schema、planner 产出的 `StoryboardPlan` IR 结构(含 `durationSec`)——不动,只改 IR→节点的落地转换。
- anchor 定妆卡/场景卡逻辑(`buildAnchorSheetPrompt`、anchorKindToNodeKind、anchor→shot 边)——不动。
- `arrange_storyboard_to_timeline` 排片(按镜号确定性排,不读连线)——不动;shot→shot 边不影响排片。
- 时间轴/导出/预览——不动。
- 「用户明说要 video」的能力——保留(eval sb-016 仍须产 video)。

## 3. 回滚策略

- 纯 prompt/skill/纯函数 + 单测改动,无数据迁移、无持久化格式变更。
- 回滚 = `git revert` 本批 commit;已落画布的旧 video 节点不受影响(历史项目里既有节点不动)。
- Phase 1、Phase 2 分 commit,可独立回退(Phase 1 灭 eval 红即有价值)。

## 4. 验收门

1. **五门**:`check:filesize` → `lint:ci` → `typecheck` → `test`(含更新后的 storyboardPlan.test.ts)→ `build` 全绿。
2. **plan 路径单测**:storyboardPlan.test.ts 新断言验证「镜头=image / shot→shot 链 / image 模型默认 / 无 duration params」。
3. **free-build eval(需 agent 额度,用户资源)**:`pnpm eval:run storyboard` 复跑,期望 `minChainEdges`/`kind` 失败显著下降、pass@1 上升。**此步烧额度,执行前提示用户**;不烧额度的前置验证靠单测 + build。
4. **R13 真机走查**(创作区拆镜头主链路 J1/J2):拆完镜头节点是 image、相邻镜头有连线、定妆卡→镜头参考边在;截图人眼对账。

## 5. 待执行时确认的实现细节(决策自治范围,执行中定)

- shot→shot 边 `mode`:用 `reference`(中性视觉连续/承接);非 `first_frame`(那是 image→video 动画化阶段的语义)。
- `resolveStoryboardVideoDefault` 是否仅此一处调用 → 是则删,否则保留只摘传参。

## 6. 执行回填(完成后填)

- [ ] Phase 1 free-build prompt + skill 对齐
- [ ] Phase 2 plan 路径 image-first + shot→shot 链 + 删 video 死码
- [ ] 单测更新 + 五门
- [ ] 回填 2026-06-13 设计文档
- [ ] (可选/需额度)eval 复跑数据
- [ ] R13 走查截图
