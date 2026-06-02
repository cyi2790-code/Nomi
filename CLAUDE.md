# Nomi 项目工程纪律 — 给 Claude 的读取项

> 每个会话开始**强制读这份**。下面两条是用户多次明确强调的硬规则，违反 = 工作错误。

## 规则 1：加新必删旧（No Parallel Versions）

**当我引入一个新组件 / 新流程替代旧的：**

- 同一 commit 里**删除被替代的旧代码**
- 不留"逃生口 / Collapse / 备选 fallback / 高级开关"——这些都是借口
- 死代码（grep 不到外部引用）立刻物理删除文件，不留"以防万一"
- 反例：M5.3 我加了 `OnboardingWizard` 但留了 `ModelCatalogImportSection`，结果用户看到两套 UI 混杂。错。
- 正例：今天的 `chore: codebase cleanup (audit 2026-05-30 section A + C)` —— 移动文件同步更新所有 import，0 残余。

**如果"不敢删"：**
- 真的不确信新方案 → 不要 ship 新方案
- 怕回归 → 加测试，不是留旧代码
- 旧的有点价值 → 把那点价值合并到新代码里，再删旧

## 规则 2：用户视角 + 极简

**做 UI / 文案 / 卡片设计前，先按这个顺序问：**

1. **用户进来要看什么？** 列出每条信息，按重要度 ⭐⭐⭐ / ⭐⭐ / ⭐ 排序。
2. **每条信息有用户行动价值吗？** 没有行动价值的信息 = 噪音 = 删。
3. **0 权重的常见嫌疑犯：**
   - 节点功能描述文字（"承接上游提示词生成图片。"）
   - onboarding 文案在每次出现（"或选中后输入提示词生成"）
   - 重复的分组标签（节点已在 "角色" group 里，节点头还写"角色"）
   - 长 error stack 灌满卡片（应缩成 ⚠️ + tooltip）
   - 双层 border / 圆角套圆角（违反 Design.md 第 6 节）
   - 永远 80px 高的"信息区"即使内容为空
4. **设计系统**：参考 `Design.md` + `src/design/`，token-only，光模式，密度优先。

**反例**：M5.3 wizard 首版我写"高级 / 专家逃生口"折叠区，留着 600 行旧代码。错。
**正例**：今天角色卡删了"角色"tag、内层 border、"或选中..."文案、用户不需要的描述行。

## 规则 3：决策格式

涉及范围 / 取舍时，**先给用户用户视角的对比表**，再让用户拍板：

```
| 方案 | 用户看到什么 | 代价 |
|---|---|---|
| A | ... | ... |
| B | ... | ... |
```

不要单方面"我建议 A"然后开干。

## 规则 4：执行前必写文档

涉及多文件 / 多步骤的改动，先在 `docs/plan/` 或 `docs/audit/` 写一份执行文档，含：
- 范围
- 不动什么
- 回滚策略
- 验收门

写完用户能预读 / 反驳；执行完回填结果。

## 关于工作目录（目录漂移——根因 + 铁律）

- 仓库根（**唯一该动的工作树**）：`/Users/aoqimin/Desktop/Nomi/.claude/worktrees/impl-v0.6.0/`
- 父目录 `/Users/aoqimin/Desktop/Nomi/` 是另一个 detached worktree，**不要在那里改东西或 commit**

**为什么老漂移（已定位，别再困惑）**：每次新开 shell 都从用户 profile 启动，默认目录是父目录 `/Users/aoqimin/Desktop/Nomi`（应用从那启动）。一次连续运行里 `cd` 会保持；但**上下文压缩 / 会话重启会重建 shell → cwd 弹回父目录**。所以漂移不是偶发，是结构性的。

**铁律（让漂移变得不可能，而不是靠记性）**：
- Read / Edit / Write 用的是绝对路径，**天然免疫**——文件操作不受漂移影响。
- 只有 Bash shell 命令会中招。所以**每条 Bash 命令都必须自锚定到绝对路径**，二选一：
  - git：用 `git -C /Users/aoqimin/Desktop/Nomi/.claude/worktrees/impl-v0.6.0 <子命令>`（不依赖 cwd）
  - 其它（pnpm/build/test/ls…）：`cd /Users/aoqimin/Desktop/Nomi/.claude/worktrees/impl-v0.6.0 && …`
- 永远不要发"裸" git/pnpm 命令（不带 `-C` 或 `cd` 前缀）——哪怕你"觉得"cwd 是对的。一次 `pwd` 验证 < 一次误 commit 到父树的代价。
