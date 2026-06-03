# C5 · 文本节点 → 文档编辑器

> 用户已确认样张方向（`docs/mockups/c5-text-node.html` v2）。本文是经设计师 + 真实用户评审后的落地方案。复杂交互，分多轮。

## 关键事实（评审挖出，纠正既有认知）
- **画布不是 React Flow**，是自研画布：`canvasZoom` 在 store，拖拽/缩放靠 `BaseGenerationNode` 的 pointer + rAF（8 向 `RESIZE_DIRECTIONS`、`MIN/MAX` 常量）。→ **不能引 React Flow NodeResizer**（规则 1），复用现成 resize-zone。
- `BaseGenerationNode.handlePointerDown` 白名单（~line 314）只放行 button/input/textarea/select，**`contenteditable` 不在内** → 不修就没法在节点里选字/打字（拖拽吞光标）。**P1 必修。**
- 创作区 `WorkbenchEditor` 已是正确接入的 Tiptap（StarterKit+Placeholder + markdown 工具 + keydown stopPropagation 挡全局快捷键 + lastEditorJsonRef 防回灌）——**复用的真相源**。

## 模块化拆分（不堆进 BaseGenerationNode）
- `hooks/useNomiRichTextEditor.ts` — 共享内核：extensions、markdown 工具、命令链、读选区。**唯一真相源**，创作区 + 文本节点同用。
- `creation/richTextActions.ts` — `buildRichTextActions(editor)` 纯函数（B/I/H/列表…），创作区渲染成横条、节点渲染成浮动 pill。
- `nodes/render/TextDocumentNode.tsx` — 文本节点 body（消费 hook + EditorContent），走 `renderKind` 分发（像 character-card 那样）。
- `nodes/render/TextFormatBar.tsx` — 浮动格式条（编辑/选中出现，自动上下翻避免飞出屏幕）。
- **同 commit 重构 `WorkbenchEditor` 消费 hook，删掉它本地的 useEditor/toolbar 内联定义**（规则 1，不留两套 Tiptap）。
- 底部模型框：复用 `NodeGenerationComposer`，给它加 `text` 执行分支（文本模型 + 文本 placeholder），不另写第二套底部框。
- 缩放：复用现成 resize-zone；文本节点 min 280×200 单独 clamp，不动全局常量。

## 评审采纳的体感要点
- **拖动 vs 编辑**（用户最怕）：点正文 = 编辑；只有抓节点头那条「Text」栏才能拖。白名单加 `[contenteditable]/.ProseMirror`；header 保持 grab，body 不抢 pointer。
- **键盘**：节点内 Tiptap keydown/keyup stopPropagation，否则打字触发画布删除等快捷键（Backspace 删节点 = 致命）。
- **格式条飞出屏幕**：贴顶时自动翻到下方。
- **生成不覆盖**：区分 续写 / 改写(选中) / 重写——默认续写(appendToEnd)，不一点生成就清空已写。
- **临时放大**：双击节点头 → 原地铺满沉浸编辑，再点缩回原位（不跳页、位置不变）。

## 分阶段（每阶段可验、可回滚）
- **P1 核心可用**：抽 `useNomiRichTextEditor` + 重构 WorkbenchEditor 复用；`TextDocumentNode` 内联可编辑 body（脱离图片预览）；持久化 `node.contentJson`；白名单+键盘修复（能在节点里安全编辑）；composer text 生成分支（默认续写不覆盖）；复用 resize。→ 文本节点变成"能写、能生成、能缩放"的文档卡片。
- **P2 体验**：浮动格式条（buildRichTextActions + 自动翻向）；双击头临时放大；生成模式 续写/改写/重写。
- **P3（远期，用户命脉）**：AI 出的分镜结构化 → 一键把每个镜头喂给下游 图片/视频 节点（文本→分镜→下游串联）。

## 设计系统 token
节点壳 `bg-nomi-paper border-nomi-line rounded-nomi shadow-nomi-md`；编辑态 `nomi-accent` 1.5px + shadow 提一级；格式条 `bg-nomi-paper border-nomi-line shadow-nomi-lg`，active `bg-nomi-accent-soft text-nomi-accent`，按钮复用 `WorkbenchIconButton`；生成按钮沿用现有 ink→accent。全部 token，无裸值。

## Context7 / 规则 5
Tiptap 是框架——下个会话 Context7 生效后，实现前查 Tiptap 官方（editable 切换、BubbleMenu/floating toolbar、防回灌）核对。本会话先以 `WorkbenchEditor` 真实代码为准。

## 回滚 / 验收
- 分阶段 commit，互不依赖。
- 每阶段 `pnpm build` 绿 + `vitest` 不回归 + 本地重建目测：能在节点里打字（不误拖）、能生成不覆盖、能缩放。

## 执行结果（回填）
- **P1 Chunk 1（数据地基）✅ commit `10042d3`**：`GenerationCanvasNode` 加 `contentJson?: TiptapDocJson`
  + zod schema `passthrough().optional()`（旧节点兼容）+ schema 测试。build + 417 测试绿。
  共享内核 `useNomiRichTextEditor` + WorkbenchEditor 重构早在 `e96facc` 完成。
- **P1 待做（接入图已就位，见本会话 Explore 报告）**：
  - Chunk 2（安全关键）：新建 `nodes/render/TextDocumentNode.tsx`（消费 hook + EditorContent +
    section stopPropagation）+ `BaseGenerationNode` renderKind 分发加 text 分支 +
    `handlePointerDown` 白名单加 `[contenteditable],.ProseMirror`（不修拖拽吞光标）+
    resize 按 kind clamp（text min 280×200）。注：全局快捷键 `GenerationCanvas.tsx:537`
    已放行 `[contenteditable]`，无需改。
  - Chunk 3（生成）：registry text 加 `executionKind:'text'` + `generationNodeExecutor` text 分支 +
    新建 `runner/textActions.ts`（读 contentJson append 新段，实现"续写不覆盖"）。
