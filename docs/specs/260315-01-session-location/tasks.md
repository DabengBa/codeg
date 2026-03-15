# 会话定位

## Phase 1: 数据与基建 (Data & Foundation)

- [x] **任务 1.1**：在 `src/lib/session-locator.ts` 定义会话定位的纯数据模型与纯函数，覆盖轮次配对、用户摘要提取、AI 最终答复摘要提取。
  - _落点_：`src/lib/session-locator.ts`
  - _依据_：`PRD §2 核心功能`、`PRD §3.1 目录建模规则`、`PRD §3.2 AI 最终答复定义`、`PRD §3.4 空态与异常状态`；`TSD §2 核心数据结构`
  - _依赖_：无
  - _约束_：纯逻辑不得依赖组件私有类型；不得把 `thinking`、`tool_use`、`tool_result` 识别为 AI 最终答复。
  - _验证_：Given 包含 `user / assistant / system / tool_only / attachment_only / optimistic user` 的原始 turn 列表，When 调用纯函数构建目录项，Then 返回的目录项能正确忽略 `system` 与孤立 `assistant`，并生成 `complete` / `pending_reply` 状态及正确摘要。
  - _建议提交_：`feat: add session locator pure models and pairing logic`

- [x] **任务 1.2**：为虚拟消息列表暴露稳定的程序化跳转 API，供会话定位触发滚动。
  - _落点_：`src/components/message/virtualized-message-thread.tsx`
  - _依据_：`PRD §2 核心功能`、`PRD §3.5 性能红线`；`TSD §3.3 VirtualizedMessageThread`
  - _依赖_：无
  - _约束_：不得依赖 DOM 锚点查询；保持现有泛型与渲染逻辑尽量不变。
  - _验证_：Given 一个已渲染的虚拟消息线程，When 父组件调用 `scrollToIndex(targetIndex)`，Then 列表滚动到目标项且不依赖 `scrollIntoView()` 或 `getElementById()`。
  - _建议提交_：`feat: expose virtualized thread scroll api for session locator`

- [x] **任务 1.3**：在 `MessageListView` 中把现有线程渲染数据归一化为会话定位可消费的原始 turn 列表。
  - _落点_：`src/components/message/message-list-view.tsx`
  - _依据_：`PRD §2 核心功能`、`PRD §3.1 目录建模规则`、`PRD §3.4 空态与异常状态`；`TSD §2.2 归一化规则`、`TSD §3.1 MessageListView`
  - _依赖_：任务 1.1
  - _约束_：保留 `persisted` turn 与 `optimistic` 用户 turn；忽略 `typing` 与 `streaming` assistant turn；不在此处做 UI 渲染判断。
  - _验证_：Given 同时包含 `persisted / optimistic / streaming / typing` 的线程数据，When 生成原始 turn 列表，Then 输出只保留定位需要的 turn，并为待回复轮次保留 `optimistic` 用户消息。
  - _建议提交_：`feat: normalize thread items for session locator`

## Phase 2: 核心功能 MVP (Core Features)

- [x] **任务 2.1**：新增会话定位悬浮卡片组件，完成折叠态/展开态壳层、标题区、数量显示和列表容器。
  - _落点_：`src/components/chat/session-locator-overlay.tsx`
  - _依据_：`PRD §2 核心功能`、`PRD §5 UI 方案补充`；`TSD §1.3 职责分离`、`TSD §5.1-§5.2 UI 实现约束`
  - _依赖_：任务 1.1
  - _约束_：沿用现有消息区 overlay card 风格；样式优先使用现有 `TailwindCSS` 与设计 token；不新增全局样式。
  - _验证_：Given 存在至少 1 条目录项，When 渲染组件，Then 默认显示折叠入口并可切换到展开卡片，标题、数量和折叠按钮均可见且可聚焦。
  - _建议提交_：`feat: add session locator overlay shell`

- [x] **任务 2.2**：在会话定位卡片中实现每个目录项的用户摘要、AI 摘要与独立点击目标。
  - _落点_：`src/components/chat/session-locator-overlay.tsx`
  - _依据_：`PRD §2 核心功能`、`PRD §3.3 交互细节`、`PRD §5.3 目录项样式`；`TSD §3.4 SessionLocatorOverlay`、`TSD §5.3 目录项结构`
  - _依赖_：任务 2.1
  - _约束_：同一卡片中的 `用户摘要` 与 `AI 摘要` 必须是两个并列点击目标；不得出现按钮嵌套按钮；`pending_reply` 项允许仅渲染用户跳转目标。
  - _验证_：Given 一条完整轮次和一条待回复轮次，When 渲染目录项，Then 用户摘要始终可点击，AI 摘要仅在存在稳定目标时可点击，且键盘焦点顺序与视觉顺序一致。
  - _建议提交_：`feat: render session locator item actions`

- [x] **任务 2.3**：在 `MessageListView` 中接入会话定位卡片、跳转回调和显示条件。
  - _落点_：`src/components/message/message-list-view.tsx`
  - _依据_：`PRD §1 意图与核心体验`、`PRD §2 核心功能`、`PRD §4 验收标准`；`TSD §3.1 MessageListView`
  - _依赖_：任务 1.2、任务 1.3、任务 2.1、任务 2.2
  - _约束_：不复制一份消息线程状态；目录为空时不显示入口；跳转必须通过虚拟列表 API 完成。
  - _验证_：Given 会话存在可定位项，When 用户点击 `用户摘要` 或 `AI 摘要`，Then `MessageListView` 调用虚拟列表跳转 API 并把线程平滑滚动到对应位置。
  - _建议提交_：`feat: integrate session locator into message list`

- [x] **任务 2.4**：补齐会话定位相关国际化文案，覆盖现有语言文件。
  - _落点_：`src/i18n/messages/en.json`、`src/i18n/messages/zh-CN.json`、`src/i18n/messages/zh-TW.json`、`src/i18n/messages/ja.json`、`src/i18n/messages/ko.json`、`src/i18n/messages/fr.json`、`src/i18n/messages/de.json`、`src/i18n/messages/es.json`、`src/i18n/messages/pt.json`、`src/i18n/messages/ar.json`
  - _依据_：`PRD §5.5 与现有架构/风格的一致性要求`；`TSD §3.5 国际化`
  - _依赖_：任务 2.1
  - _约束_：保持所有语言文件键结构一致；不得引入缺键运行时错误。
  - _验证_：Given 任意已支持语言，When 渲染会话定位组件，Then 不出现缺失翻译 key，标题、标签、占位文案与 aria 文案均可正确显示。
  - _建议提交_：`i18n: add session locator messages`

- [x] **任务 2.5**：实现跳转后的目标高亮反馈，帮助用户快速确认命中的具体位置。
  - _落点_：`src/components/message/message-list-view.tsx`、`src/components/message/use-message-highlight.ts`、`src/components/message/content-parts-renderer.tsx`、`src/app/globals.css`
  - _依据_：`PRD §2 核心功能`、`PRD §3.3 交互细节`、`PRD §4 验收标准`；`TSD §3.1 MessageListView`、`TSD §3.5 跳转后高亮反馈`
  - _依赖_：任务 2.3
  - _约束_：高亮必须自动消退；命中具体 part 时优先高亮该 part，并辅以 turn 级弱高亮提升可见性；没有可命中的 part 时回退为高亮整个 turn 容器；高亮淡出优先使用 CSS 动画而不是生硬瞬间消失。
  - _验证_：Given 用户从会话定位点击一条用户摘要或 AI 摘要，When 跳转完成，Then 命中的目标内容会以明显可见的高亮反馈短暂突出并自然淡出；Given 目标内容是 `tool-result` 或大代码块，Then 高亮边缘不会因为父容器裁剪而难以察觉。
  - _建议提交_：`feat: highlight session locator jump target`

## Phase 3: 边界验证与联调 (Edge Cases & Integration)

- [x] **任务 3.1**：实现待回复轮次、仅工具调用、仅图片/附件、空摘要等降级状态在目录中的完整表达。
  - _落点_：`src/lib/session-locator.ts`、`src/components/chat/session-locator-overlay.tsx`
  - _依据_：`PRD §2 核心功能`、`PRD §3.1-§3.4`、`PRD §4 验收标准`；`TSD §2.4 摘要提取规则`、`TSD §5.3 目录项结构`
  - _依赖_：任务 1.1、任务 2.2
  - _约束_：待回复轮次至少允许跳到用户消息；占位文案必须弱化处理，不与正常正文抢夺注意力。
  - _验证_：Given `pending_reply`、`tool_only`、`attachment_only`、`empty` 等目录项，When 目录渲染完成，Then 每种状态均有清晰、可验证的降级表现，且不会把 AI 中间过程误当成最终答复。
  - _建议提交_：`feat: handle session locator fallback states`

- [x] **任务 3.2**：对齐“会话定位”与“计划”浮层的折叠/展开行为，不引入额外的强制折叠特化逻辑。
  - _落点_：`src/components/message/message-list-view.tsx`
  - _依据_：`PRD §2 核心功能`、`PRD §3.3 交互细节`、`PRD §5 UI 方案补充`；`TSD §3.2 与 AgentPlanOverlay 行为对齐`、`TSD §5.4 响应式与协同`
  - _依赖_：任务 2.3
  - _约束_：不得为会话定位新增不同于“计划”浮层的展开/收起规则；不反向修改现有 `AgentPlanOverlay` 行为。
  - _验证_：Given 会话定位存在目录项，When 用户点击折叠入口，Then 会话定位像“计划”浮层一样展开完整卡片；When 用户点击收起按钮，Then 返回折叠入口。
  - _建议提交_：`refactor: align session locator behavior with plan overlay`

- [x] **任务 3.3**：验证会话定位接入后不改变现有消息区关键交互，包括计划卡片、输入链路、自动滚动与流式状态展示。
  - _落点_：`src/components/message/message-list-view.tsx`、`src/components/message/use-message-highlight.ts`（必要时仅做最小集成修正）
  - _依据_：`PRD §3.5 性能红线`、`PRD §4 验收标准`；`TSD §1.2 实现边界`、`TSD §5.4 响应式与协同`
  - _依赖_：任务 2.3、任务 3.2
  - _约束_：任何为会话定位做的共享代码调整，都不能改变其他功能的既有行为语义或视觉风格。
  - _验证_：Given prompting 中的会话同时显示计划卡片、LiveTurnStats 和输入区，When 启用并使用会话定位，Then 计划卡片仍可正常展开收起，发送后的自动滚动仍然有效，输入和流式状态展示无回归；Given assistant turn 前部存在大量 thinking / tool use 内容，When 点击 AI 摘要，Then 视口仍会继续校正到最终答复位置而不是停留在 turn 首屏；Given 跳转目标在可视上无法完全命中，Then 至少会输出可观测的开发态日志。
  - _建议提交_：`refactor: preserve message panel behavior while adding session locator`

## Phase 4: 验收标准对齐 (DoD Review)

- [ ] **任务 4.1**：按 `PRD §4 验收标准` 逐条进行手动验收，记录核心路径与边界场景结果。
  - _落点_：`docs/specs/260315-01-session-location/tasks.md`（回填完成勾选与必要备注）
  - _依据_：`PRD §4 验收标准`
  - _依赖_：任务 1.1 ~ 3.3
  - _验证_：Given 长会话、待回复轮次、仅工具调用、仅附件、连续用户消息、与计划卡片同时存在等场景，When 按 DoD 清单逐项验证，Then 所有条目均有明确通过结果或待修复记录。
  - _备注_：代码实现、类型检查、定向 lint 与生产构建已完成；仍建议在桌面 UI 中做一次最终人工回归。
  - _建议提交_：`docs: review session locator against PRD dod`

- [x] **任务 4.2**：运行仓库现有的静态检查，并确认会话定位接入没有引入新的类型或 lint 问题。
  - _落点_：涉及本功能修改的所有文件
  - _依据_：`PRD §4 验收标准`；`TSD §4 测试与验证策略`
  - _依赖_：任务 1.1 ~ 3.3
  - _约束_：只修复与本功能改动直接相关的问题，不顺手扩散到无关模块。
  - _验证_：Given 会话定位相关修改已完成，When 运行仓库既有静态检查流程，Then 不引入新的类型错误或 lint 错误。
  - _备注_：`pnpm.cmd exec tsc --noEmit`、会话定位相关文件的定向 `eslint`、以及 `pnpm.cmd build` 已通过；仓库级 `pnpm.cmd exec eslint .` 仍存在大量既有 CRLF/Prettier 问题，与本功能改动无关。
  - _建议提交_：`chore: validate session locator changes`
