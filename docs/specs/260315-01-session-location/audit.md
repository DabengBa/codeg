# Code Audit

## Summary

- 结论：批准（无阻塞项）
- 风险概览：
  - 关键体验仍建议补一次人工回归记录，尤其是与 `AgentPlanOverlay` 共存、待回复轮次、键盘焦点顺序
  - `MessageListView` 已成为本次功能的复杂度热点，后续继续叠加逻辑时应警惕可读性下滑
- 范围：本次审计仅覆盖会话定位相关改动与同步文档，包括 `src/lib/session-locator.ts`、`src/components/chat/session-locator-overlay.tsx`、`src/components/message/message-list-view.tsx`、`src/components/message/virtualized-message-thread.tsx`、`src/i18n/messages/*.json`、`docs/specs/260315-01-session-location/*`

## Verification Log

- `git diff --cached --stat` → 17 个文件变更；高风险集中在 `message-list-view.tsx`、`virtualized-message-thread.tsx`、`session-locator-overlay.tsx`、`session-locator.ts`
- `pnpm.cmd exec tsc --noEmit` → 通过
- `pnpm.cmd exec eslint src/lib/session-locator.ts src/components/message/virtualized-message-thread.tsx src/components/chat/session-locator-overlay.tsx src/components/message/message-list-view.tsx` → 通过
- `pnpm.cmd build` → 通过
- `pnpm.cmd exec eslint .` → 失败；输出显示仓库存在大量既有 CRLF/Prettier 问题，无法作为本次改动的有效阻断依据

## Findings

1. [中] 关键体验验证仍存在缺口，当前证据主要覆盖“能编译 / 能构建”，还没有形成最终 UI 回归记录
   - 影响：本次改动是消息区内悬浮交互 + 虚拟列表跳转，风险集中在与 `AgentPlanOverlay` 共存、待回复轮次、键盘焦点、仅工具调用与仅附件场景；仅靠 `tsc` / 定向 `eslint` / `build` 不能完全证明体验符合 DoD。
   - 证据：
     - `tasks.md` 中人工 DoD 回归仍未完成：`docs/specs/260315-01-session-location/tasks.md:87-92`
     - 当前已有静态检查和构建通过，但没有回填人工回归结论或截图/GIF
   - 建议：
     - 补一轮最小人工验证矩阵：长会话、待回复轮次、仅工具调用、仅附件、与计划卡片同时存在、键盘 Tab/Enter 交互
     - 将结果回写 `tasks.md` 或补充到 PR 描述，形成可追溯的验证证据
   - 验证：
     - Given 上述 6 类场景
     - When 逐条执行手动回归
     - Then 每项都有“通过/失败/备注”记录，且失败项能复现并定位

2. [低] 文档和实现目前已对齐为“与计划浮层完全一致”的行为模型，后续不要重新引入特化的窄宽度逻辑
   - 影响：如果后续再次给会话定位加入不同于 `AgentPlanOverlay` 的特化行为，会重新引入双轨心智和维护成本。
   - 证据：
     - PRD 已改为“与计划浮层行为一致”：`docs/specs/260315-01-session-location/PRD.md:20`
     - TSD 已改为“与 AgentPlanOverlay 行为对齐”：`docs/specs/260315-01-session-location/TSD.md:189-197`
     - 当前实现已移除 `compact` 特化，保留与计划浮层一致的折叠/展开模型：`src/components/chat/session-locator-overlay.tsx:114-168`
   - 建议：
     - 后续若要优化极窄场景，优先评估是否应同步改动“计划”浮层，而不是只让会话定位单独特化
   - 验证：
     - Given 同时存在计划浮层与会话定位
     - When 比较二者的折叠 / 展开交互
     - Then 二者行为模型一致，不出现只属于会话定位的额外规则

## Follow-ups

- 建议拆成 2 个后续小任务：
  - `docs: record session locator manual verification matrix`
  - `refactor: extract session locator state helper from message list if logic continues growing`
