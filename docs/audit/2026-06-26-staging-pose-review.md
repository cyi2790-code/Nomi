# 2026-06-26 站位参考图「姿势/人物」体检 + 修复

> 触发：用户反馈 `create_staging_reference`（AI 做 3D 导演台参考图）**经常姿势/人物有问题**。
> 方法：写 30 个覆盖用例 → 每例多视角（hero/front/q3/side/back/top）离屏出图 → 子 agent(VLM) 逐例审查 →
> 发现问题挖根因修 → 重渲染重审 → **直到 30 例全部子 agent 判 pass**。
> 测试资产（常驻）：`src/devlab/stagingTestCases.ts`（30 例单源）+ `src/devlab/stagingShots.tsx` + `staging-shots.html`
> + `tests/ux/staging-pose-shots.walk.mjs`（vite dev + chromium 多视角出图）+ `stagingPoses.test.ts`（静态不变量）。

## 首轮审查结论（30 例，子 agent 判定）
- **断肢/反关节/穿插：0 例**（骨骼姿势引擎本身没有断肢类问题）。
- **悬空/陷地（落地失败）**：sit / squat / single-knee / double-knee / interview / squat-stand —— 深屈姿势全中。
- **姿势走形**：squat 后仰跌坐踮脚尖、sit 脚尖下垂、single-knee 后脚翘起整条腿悬空。
- **朝向/穿插假阳性**：propose / standoff / intimate-close —— 实为 harness 环绕「背/侧视角」沿角色排布轴
  正对，把投影遮挡误读成穿插/同朝向（顶视实为清晰分离，多个其他例的子 agent 正确识别为投影遮挡）。

## 根因与修复（都修在根因层，整类不复发 = P2）

### R1 落地按「骨骼关节点」而非「蒙皮网格」——深屈姿势全部悬空/陷地（最大根因）
- 根因：`scene3dMath.ts` 旧 `lowestBoneLocalY` 用骨骼**关节点**求最低点落地。脚踝/脚尖关节到鞋底网格的
  偏移会随脚的勾绷（dorsi/plantar-flex）变化；坐/蹲/跪这类脚姿大变的预设按关节落地 → 鞋底网格悬空或陷地
  约 0.7~0.9 世界单位（量化实测）。站立/行走脚姿接近默认故没暴露。
- 修复：新增 `lowestMannequinLocalY`，用 `SkinnedMesh.applyBoneTransform` 取**每个顶点蒙皮变形后**的世界
  最低 Y 落地。任何姿势的真实最低点（鞋底/膝盖）都精确贴地。仅姿势变化时跑一次，开销可忽略。
- 量化验证（蒙皮真实最低点世界 Y，应≈0）：修前 sit −0.69 / squat −0.94 / single-knee −0.66 / double-knee −0.74
  → 修后全部 ≈0（0~0.07）。

### R2 深屈姿势的脚轴向填反/过度——踮脚尖后仰、脚尖下垂、后脚翘起
- 实测脚轴向：**+ = 跖屈（脚尖下）/ − = 背屈（脚尖上）**（pose-lab probe 校准）。
- `sit`：脚 +28 → 脚尖下垂；改 **−18** + 小腿 88→90，脚掌踩平。
- `squat`：脚 +42（踮脚尖）致整体后仰跌坐；改腿 UpLeg115/Leg125→**100/106**、脚 **−30**（背屈踩平），
  脚跟落地、不再后仰。
- `single-knee`：前脚 +15→**−18**（踩平）；后脚 +38（翘起整腿悬空）→ **+68**（大幅跖屈脚背贴地）、
  小腿 100→118，后膝/小腿稳稳着地。

### R3 测试 harness 的环绕视角制造朝向/穿插假阳性 + 落地不可读
- 根因：环绕视角俯仰角太低（6°）地面近乎边缘看不见 → 深屈姿势「看着像悬空」；且方位角正对角色排布轴
  （side 90° / back 180°）→ 面对面/纵队角色完全互相遮挡 → VLM 误读成穿插。
- 修复（`stagingShots.tsx`）：① 俯仰角抬到 ≥14°，地面读得出；② 方位角偏开正轴（side 78/back 205/top 偏 20），
  任何视角角色都不完全重叠；③ 加**顶光投影**——脚/膝落地时影子贴住接触点、悬空则有缝，给子 agent 最硬的
  落地判据；④ 审查 prompt 明确「顶视是判分离/朝向的权威视角，单视角遮挡而顶视分离=投影非缺陷；坐跪无椅,
  臀悬空在座高是正常,只按接触点(脚/膝影子)判落地」。

## 复审结果：30/30 全部 pass（最终渲染、子 agent 判定）
- solo 12：standing / t-pose / walk / run / sit / squat / single-knee / double-knee / hands-on-hips / point / wave / cheer ✓
- 互动 8：propose / interview / standoff / point-at / trio-mixed-pose / squat-stand / intimate-close / behind-depth ✓
- 布局机位 10：line-four / circle-four / circle-overhead / five-row / behind-high / solo-away / trio-mixed-facing / back-camera / cheer-crowd / run-low ✓

## 改动文件（生产代码）
- `src/workbench/generationCanvas/nodes/scene3d/scene3dMath.ts`：蒙皮最低点落地（R1）。
- `src/workbench/generationCanvas/nodes/scene3d/scene3dConstants.ts`：sit/squat/single-knee 脚踝与腿角校准（R2）。

## 复跑方式
```
node tests/ux/staging-pose-shots.walk.mjs        # 出 30 例 × 6 视角 PNG 到 tests/ux/_stagingshot/
# 再用子 agent 逐例读图审查（断肢/悬空/穿插/朝向/落地影子）
npx vitest run src/workbench/.../scene3d/stagingPoses.test.ts   # 静态不变量(枚举不漂移/骨骼名/角度合理)
```
