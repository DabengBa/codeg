# 会话定位 - Tech Spec

## 🏗️ 1. 架构与依赖约束 (Architecture & Constraints)

### 1.1 宏观类别与复杂度

- **宏观类别**：UI 实现 + 派生数据建模 + 虚拟列表跳转 + 响应式浮层协同。
- **复杂度判断**：中等。
- **复杂度来源**：
  - 需要从现有消息线程中派生“轮次导航”数据，而不是直接消费后端现成字段
  - 需要与现有虚拟滚动列表正确集成
  - 需要与现有“计划”悬浮卡片共存

### 1.2 实现边界

- **前端内聚实现**：本功能仅在前端完成，不修改 Rust 解析器、不新增 Tauri 命令、不修改数据库或会话持久化结构。
- **业务流程与验收标准**：见 `PRD.md`，本文不重复描述用户流程，只说明技术实现方式。
- **核心目标**：在不破坏现有消息线程、输入链路、计划卡片与滚动体验的前提下，为会话详情页增加可维护、可测试的轮次定位能力。

### 1.3 职责分离

- **`MessageListView`**：负责编排；从现有线程数据中整理出定位所需的“原始 turn 列表”，并持有滚动相关状态。
- **`src/lib/session-locator.ts`**：只负责纯业务逻辑；输入为通用原始 turn 列表，输出为目录项，不依赖具体 UI 组件类型。
- **`VirtualizedMessageThread`**：只负责虚拟滚动与程序化跳转能力，不感知“会话定位”的业务语义。
- **`SessionLocatorOverlay`**：只负责展示、展开/折叠状态与点击交互，不负责解析消息数据。

### 1.4 依赖与复用约束

- **消息来源**：继续复用 `MessageListView` 中已经整理好的线程数据，不重复从底层会话详情重新构建整套时间线。
- **滚动实现**：继续复用现有 `VirtualizedMessageThread` 的 `@tanstack/react-virtual` 虚拟滚动能力，禁止改用 DOM 锚点定位。
- **UI 范式**：复用现有 `AgentPlanOverlay` 的“消息区内部悬浮卡片”模式，不新引入独立的浮层交互体系。
- **状态范围**：不新增全局 store；定位卡片状态只在消息区局部组件树内管理。
- **国际化**：继续使用 `next-intl`，新增文案键时保持与现有 `Folder.chat.*` 命名层级一致。

### 1.5 可维护性约束

- **禁止让 lib 依赖组件私有类型**：`session-locator.ts` 不能直接依赖 `ThreadRenderItem` 这类组件内部类型；归一化应在 `MessageListView` 完成。
- **避免双重解析**：定位逻辑优先消费已适配的前端消息表示，不重复解析原始 Markdown / 原始后端块结构。
- **避免过度抽象**：本期不提前设计“通用导航平台”“通用摘要系统”等超出当前需求边界的抽象层。

### 1.6 文件目录

- **新增纯逻辑模块**：`src/lib/session-locator.ts`
- **新增 UI 组件**：`src/components/chat/session-locator-overlay.tsx`
- **修改消息列表入口**：`src/components/message/message-list-view.tsx`
- **修改虚拟滚动容器**：`src/components/message/virtualized-message-thread.tsx`
- **新增国际化键**：`src/i18n/messages/*.json`

### 1.7 样式与影响范围约束

- **样式实现优先级**：纯视觉样式优先使用现有 `TailwindCSS` 工具类、设计 token 与既有组件样式能力实现。
- **避免为样式滥用 JS**：布局、间距、截断、透明度、hover / focus、响应式等纯样式问题，不额外引入 JS 状态或运行时计算。
- **允许必要的 JS 参与行为层**：展开 / 折叠状态、虚拟列表跳转、宽度测量、键盘交互与可访问性控制，允许并且应当使用必要的 JS；不为了“纯 CSS”而牺牲可维护性和正确性。
- **关于 `rem` 的使用**：`rem` 是长度单位，不是样式方案；本项目优先复用现有 Tailwind 类和设计 token，只有在现有 token 无法清晰表达时再谨慎补充 `rem` 尺寸。
- **不新增全局样式污染**：本功能不新增全局 CSS 规则、不修改全局样式基线、不引入新的样式体系。
- **变更范围控制**：本次 PRD / TSD 只关注“会话定位”能力本身；实现时允许修改少量共享集成点（如消息列表、虚拟滚动容器、国际化文案），但这些修改只能服务于会话定位接入，不能改变其他功能的既有交互、视觉风格或行为语义。

---

## 💾 2. 核心数据结构 (Data Models)

```typescript
type SessionLocatorPhase = "persisted" | "optimistic" | "streaming"

type LocatorRole = "user" | "assistant"

type LocatorPreviewKind =
  | "text"
  | "tool_only"
  | "attachment_only"
  | "pending_reply"
  | "empty"

interface SessionLocatorRawTurn {
  turnId: string
  role: "user" | "assistant" | "system"
  phase: SessionLocatorPhase
  threadIndex: number
  parts: AdaptedContentPart[]
  resourceCount: number
  imageCount: number
}

interface SessionLocatorPreview {
  text: string
  kind: LocatorPreviewKind
}

interface SessionLocatorTarget {
  role: LocatorRole
  turnId: string
  threadIndex: number
  preview: SessionLocatorPreview
}

interface SessionLocatorItem {
  id: string
  pairIndex: number
  status: "complete" | "pending_reply"
  user: SessionLocatorTarget
  assistant: SessionLocatorTarget | null
}

interface VirtualizedMessageThreadHandle {
  scrollToIndex: (
    index: number,
    options?: {
      align?: "start" | "center" | "end" | "auto"
      behavior?: "auto" | "smooth"
    }
  ) => void
}
```

### 2.1 数据来源说明

- `SessionLocatorRawTurn` 是前端衍生模型，不落库、不跨 IPC。
- 它由 `MessageListView` 从当前线程渲染数据中归一化得到，只保留定位功能真正需要的最小字段。
- `SessionLocatorItem` 是最终供 UI 渲染的目录项模型，一项代表一轮对话。
- `status` 用于显式区分“已有 AI 最终答复的完整轮次”与“只有用户消息的待回复轮次”。

### 2.2 归一化规则

- 仅处理 `kind === "turn"` 的线程项，忽略 `typing`。
- **保留 `persisted` turn**：用于历史会话与已完成本地回填的轮次。
- **保留 `optimistic` 的用户 turn**：用于展示“用户已发出，但 AI 尚未稳定完成”的待回复轮次。
- **忽略 `streaming` assistant turn**：避免目录结构和摘要随着流式内容频繁抖动。
- `system` turn 不进入目录，也不参与配对。
- 归一化阶段仅做字段收缩，不做轮次配对。

### 2.3 配对规则

- 遍历顺序按消息线程自然顺序一次扫描：
  1. 看到 `user` → 关闭上一个未完成轮次并新建当前轮次
  2. 看到 `assistant` 且当前存在未闭合 `user` → 挂到当前轮次
  3. 看到没有前置 `user` 的 `assistant` → 跳过
- 如果连续出现多个 `user` turn：
  - 前一个 `user` 以 `pending_reply` 结束
  - 后一个 `user` 继续开启新的目录项
- 一条目录项最多只配对一个 assistant turn；本期不尝试把更复杂的跨轮追补行为再建模。

### 2.4 摘要提取规则

- **用户摘要**：从该 `user` turn 的可读文本中提取首个非空文本；若无文本，则按优先级降级：
  1. 有图片或资源 → `attachment_only`
  2. 其他空内容 → `empty`
- **AI 最终答复摘要**：从该 `assistant` turn 的内容中倒序查找最后一个可读文本块。
- `thinking`、`tool-call`、`tool-result` 不作为 AI 最终答复正文。
- 如果 `assistant` turn 没有任何可读文本，则摘要标记为 `tool_only`。
- **AI 跳转目标**：优先使用该 `assistant` turn 中最后一个非空文本块的 `partIndex`；如果没有正文文本，则回退到该 turn 最后一条可渲染内容的 `partIndex`。
- 如果该轮没有 assistant turn，则目录项 `status = "pending_reply"`，assistant 目标为 `null`。

### 2.5 纯函数建议

`src/lib/session-locator.ts` 中建议至少包含以下纯函数：

```typescript
function buildSessionLocatorItems(
  turns: SessionLocatorRawTurn[]
): SessionLocatorItem[]

function extractUserPreview(turn: SessionLocatorRawTurn): SessionLocatorPreview

function extractAssistantFinalPreview(
  turn: SessionLocatorRawTurn
): SessionLocatorPreview
```

说明：

- `MessageListView` 负责把线程数据转换成 `SessionLocatorRawTurn[]`
- `session-locator.ts` 不负责理解 `ThreadRenderItem` 或其他组件私有结构

---

## 🔌 3. 核心集成点 (Integrations)

### 3.1 `MessageListView`

职责：

- 基于现有线程渲染数据生成 `SessionLocatorRawTurn[]`
- 通过 `useMemo` 构建 `SessionLocatorItem[]`
- 持有虚拟列表实例 ref
- 持有当前高亮目标的局部 UI 状态，并负责在跳转后触发短暂高亮
- 响应目录点击并触发滚动

建议改动：

- 在线程数据 `threadItems` 生成后，新增一层 `locatorRawTurns`
- 在组件底部挂载 `<SessionLocatorOverlay />`
- 为 overlay 提供：
  - `items`
  - `locatorKey`
  - `visible`
  - `onJumpToTarget`

集成约束：

- 不把目录逻辑塞进 `renderThreadItem`
- 不让 overlay 直接读取上下文或自行推导消息列表
- 不复制一份消息线程状态到额外的本地 store

### 3.2 与 `AgentPlanOverlay` 行为对齐

问题来源：

- 会话定位与现有 `AgentPlanOverlay` 同属消息区内部悬浮卡片；如果行为模型不同，会增加用户心智负担，也会让后续维护出现双轨逻辑。

建议方案：

- 会话定位沿用 `AgentPlanOverlay` 的交互模型：
  - 有数据时渲染浮层
  - 默认折叠
  - 点击折叠入口可展开完整卡片
  - 不引入 click-away 自动关闭
- 不为本期额外增加“窄宽度强制折叠”特化逻辑，避免与“计划”浮层产生行为偏差。

### 3.3 `VirtualizedMessageThread`

职责：

- 暴露稳定的程序化滚动 API

建议实现：

- 使用 `forwardRef + useImperativeHandle`
- 对外暴露 `scrollToIndex(index, options)`
- 对外暴露 `getScrollElement()`，供目标 part 的精确对齐使用
- 内部仍由 `useVirtualizer()` 管理虚拟滚动，不暴露 TanStack 实例本身

原因：

- 保持依赖倒置：上层知道“我要跳到第 N 项”，但不依赖虚拟化库的完整实现细节
- 仓库中已有 imperative handle 交互模式，可复用现有风格
- TanStack Virtual 已提供 `scrollToIndex` 能力，可满足当前需求

### 3.4 `SessionLocatorOverlay`

职责：

- 纯展示与用户交互
- 管理展开/折叠状态
- 根据 props 渲染目录项及空态

建议 props：

```typescript
interface SessionLocatorOverlayProps {
  items: SessionLocatorItem[]
  locatorKey?: string | null
  visible?: boolean
  defaultExpanded?: boolean
  onJumpToTarget: (target: SessionLocatorTarget) => void
}
```

实现约束：

- 不内聚消息解析逻辑
- 不直接访问 DOM 或滚动容器
- 展开/折叠状态按 `locatorKey` 区分

### 3.5 跳转后高亮反馈

建议方案：

- `MessageListView` 持有一个局部 `highlightedTarget` 状态，字段至少包含：
  - `turnId`
  - `partIndex`
  - `token`
- 点击会话定位项时：
  1. 先通过虚拟列表滚动到目标 turn
  2. 等待目标 turn / part 完成挂载，并基于真实滚动容器做对齐校正
  3. 若存在 `partIndex`，循环校正滚动位置，直到该 part 的顶部进入预期可视锚点；若没有 `partIndex`，则以整个 turn 为目标
  4. 同步设置 `highlightedTarget`，让目标 part 强高亮、对应 turn 弱高亮
  5. 定时自动清除高亮
- 若目标没有可用 `partIndex`，则回退为高亮对应 turn 容器。

实现约束：

- 高亮是局部 UI 状态，不进入全局 store，也不写入持久化数据。
- 高亮必须自动消退，避免形成长期“脏状态”。
- 连续点击同一目标时，允许重新触发一次高亮。
- 长 assistant turn 的定位准确性高于长距离 `smooth` 动画；远距离跳转使用虚拟列表粗定位 + DOM 二次校正，避免因为动态高度或测量延迟停留在 turn 首屏。
- 校正滚动必须允许多帧重试，直到目标进入视口锚点或达到明确的重试上限，避免单次测量被虚拟列表动态高度误导。

### 3.6 国际化

建议新增命名空间：`Folder.chat.sessionLocatorOverlay`

建议最小键集：

```json
{
  "title": "会话定位",
  "collapseAria": "折叠会话定位",
  "collapsedSummary": "定位 {count}",
  "userLabel": "用户",
  "assistantLabel": "AI",
  "toolOnly": "仅工具调用",
  "attachmentOnly": "图片/附件",
  "pendingReply": "等待回复",
  "emptyPreview": "无可用摘要",
  "jumpToUserAria": "跳转到用户消息",
  "jumpToAssistantAria": "跳转到 AI 回复"
}
```

注意：

- 保持所有现有语言文件键结构一致，避免运行时缺键或构建不一致。

---

## 🧪 4. 测试与验证策略 (Testing Vibes)

### 4.1 单元测试优先对象

仓库当前未配置测试框架，因此本期**不引入新的测试基础设施**。  
为了保证后续可测，应优先让以下逻辑保持纯函数、可隔离：

- `buildSessionLocatorItems()`
- `extractUserPreview()`
- `extractAssistantFinalPreview()`

若后续引入测试框架，优先覆盖这些纯函数，而不是先写 UI 集成测试。

### 4.2 建议覆盖的逻辑用例

- **标准链路**：`user -> assistant(text)` 能生成完整目录项
- **复杂链路**：`user -> assistant(thinking + text + tool + text)` 只取最后文本作为 AI 摘要
- **仅工具调用**：assistant 无文本时显示 `tool_only`
- **仅附件消息**：user 无文本但有图片/资源时显示 `attachment_only`
- **待回复轮次**：`optimistic` user 会生成 `pending_reply` 目录项
- **连续用户消息**：连续多个 user turn 会生成多个待回复项，不互相覆盖
- **系统消息夹杂**：system 不进入目录、不破坏配对
- **孤立 assistant**：没有前置 user 的 assistant 被忽略
- **流式中 turn**：`phase === streaming` 不进入目录

### 4.3 人工验证点

- 展开/折叠“会话定位”不会影响现有“计划”卡片
- 点击用户摘要、AI 摘要都能稳定命中目标；长 assistant turn 仍能落到最终答复而非停留在 turn 首屏
- 长会话中展开目录和多次跳转无明显卡顿
- 待回复轮次能出现且仅支持跳到用户消息
- 消息区变窄时，定位卡片会按预期退化，不遮挡正文主路径
- 焦点可见、键盘可操作
- 中英文等多语言下卡片布局不崩坏

---

## 🎨 5. UI 实现约束 (UI Implementation)

### 5.1 布局策略

- 挂载在消息区 `relative` 容器内部，与 `AgentPlanOverlay` 同层。
- 左侧定位卡片使用与计划卡片相同的空间语言：
  - `absolute`
  - `top-4`
  - `left-8`
  - `z-20`
- 不使用 Portal，不跨出消息区容器。

### 5.2 风格复用

- 外层卡片延续现有视觉 token：
  - `rounded-xl`
  - `border`
  - `bg-card/60`
  - `shadow-lg`
  - `backdrop-blur`
- 标题栏继续使用：
  - 左图标
  - 标题文本
  - `Badge`
  - 右上角折叠 `Button`
- 折叠态入口沿用与计划卡片一致的小按钮风格。

### 5.3 目录项结构

- 每个 `SessionLocatorItem` 渲染为一个轻量边框块。
- 每条摘要点击目标使用原生 `button` 或等价可访问交互元素，不使用 `div + onClick`。
- 同一卡片中的“用户摘要”“AI 摘要”必须是两个并列点击目标，不能出现按钮嵌套按钮。
- 摘要文本使用现有消息区字号与截断方式，例如两行截断、短标签 + 正文的组合。
- `pending_reply` 项允许不渲染 AI 跳转按钮，或渲染禁用/弱化态文案，但语义必须清晰。

### 5.4 响应式与协同

- 默认状态为折叠，减少与现有正文、计划卡片的竞争。
- 不修改 `AgentPlanOverlay` 的现有交互与布局逻辑；会话定位对其做协同适配，而不是反向侵入。

### 5.5 可访问性

- 目录容器使用合适的 `aria-label` 或 `role="navigation"`。
- 所有点击目标必须有明确的 `aria-label`。
- `focus-visible` 必须清晰可见。
- 目录中不出现仅靠颜色传达语义的状态差异。

---

## ⚙️ 6. 实现步骤 (Implementation Path)

### Step 1：抽离纯逻辑

- 新增 `src/lib/session-locator.ts`
- 实现轮次配对与摘要提取纯函数
- 让纯逻辑只消费 `SessionLocatorRawTurn[]`

### Step 2：扩展虚拟列表 API

- 为 `VirtualizedMessageThread` 增加 ref handle
- 对外暴露 `scrollToIndex`
- 保持现有渲染逻辑与泛型签名尽量不变

### Step 3：接入消息列表

- 在 `MessageListView` 中把线程渲染数据归一化为 `SessionLocatorRawTurn[]`
- 增加点击回调 `handleJumpToThreadIndex`
- 将 overlay 与现有 `AgentPlanOverlay` 并列挂载

### Step 4：实现 overlay UI

- 新增 `SessionLocatorOverlay`
- 完成折叠态、展开态、目录项、待回复态、空态与键盘交互
- 复用现有 `Button`、`Badge`、`cn`、`useTranslations`

### Step 5：补齐国际化

- 新增 `Folder.chat.sessionLocatorOverlay`
- 更新所有语言文件的同名键，至少保证结构完整

---

## 🔍 7. 风险与取舍 (Risks & Trade-offs)

### 风险 1：AI “最终答复”并非底层显式字段

- **现状**：当前数据模型没有 `final_output` 标记
- **方案**：以前端规则“assistant turn 的最后一个文本块”作为高置信推断
- **取舍**：接受这是一种产品定义，而非协议级真值

### 风险 2：虚拟列表跳转不能依赖 DOM

- **现状**：目标项可能未挂载
- **方案**：先通过 `VirtualizedMessageThread` 暴露的程序化滚动 API 把目标 turn 拉入可视区，再基于真实滚动容器做多帧校正
- **取舍**：增加一个小型 imperative handle 与少量重试逻辑，换取动态高度场景下的正确性和稳定性

### 风险 3：与 `AgentPlanOverlay` 行为漂移

- **现状**：如果会话定位引入不同于“计划”浮层的交互模型，用户需要额外学习一套规则，后续维护也会出现双轨成本
- **方案**：保持折叠/展开行为、视觉结构与“计划”浮层一致，不单独增加特化退化逻辑
- **取舍**：接受极窄场景下的体验与“计划”浮层保持同样边界，而不是为单一功能单独特殊处理

### 风险 4：纯逻辑对 UI 私有类型形成反向耦合

- **现状**：如果 `session-locator.ts` 直接依赖 `ThreadRenderItem`，后续消息区结构调整会连带破坏定位逻辑
- **方案**：把归一化放在 `MessageListView`，让 lib 只消费通用 DTO
- **取舍**：多写一层轻量映射，换取职责清晰与可测试性

---

## ✅ 8. 落地完成标准

- 代码结构清晰：解析、UI、滚动三层职责清晰分离
- 不修改后端模型与存储
- 不破坏现有消息区滚动与计划卡片
- 文案、样式、交互与项目现有 UI 体系一致
- 关键推导逻辑已被设计为可独立验证的纯函数
