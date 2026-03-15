# Simplification Audit

## Executive Summary

- 热点区域：`src/components/message/message-list-view.tsx`
- 复杂度来源：
  - 同一组件中混合线程适配、计划提取、定位原始数据归一化与跳转编排
  - 会话定位虽已避免侵入全局状态，但局部编排逻辑正在变长
- 建议策略：保持当前行为模型不再分叉；下一步优先收敛 `MessageListView` 的局部接口，而不是再增加新的行为开关

## Recommendations

| 区域                                              | 问题                                                                         | 建议                                                                                                                                     | 影响 | 成本 | 验证                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | --------------------------------------------------------------------------------- |
| `src/components/message/message-list-view.tsx`    | 线程适配、定位原始数据归一化、计划检测和跳转编排混在同一组件内，阅读负担上升 | 抽一个局部 helper / hook（如 `useSessionLocatorState`），只返回 `items / onJumpToIndex`；保留 `MessageListView` 负责装配，不改变外部契约 | 中   | M    | 抽离后 `MessageListView` 渲染主体长度下降，`tsc` / 定向 `eslint` / `build` 仍通过 |
| `src/components/chat/session-locator-overlay.tsx` | 已与 `AgentPlanOverlay` 行为对齐，但两者仍存在部分重复的折叠卡片结构         | 暂不强行抽公共基类；只有当第二个相似 overlay 再出现或当前两者继续同步演进时，再考虑抽共享 shell                                          | 低   | M    | 若后续抽壳，两个 overlay 的行为与样式均不回归                                     |
| `src/i18n/messages/*.json`                        | 非中文语言目前复用英文文案，运行无问题，但不是最终多语言质量上限             | 维持当前策略不阻塞功能；若准备面向多语言发布，再补真实翻译，不建议当前为统一而扩散改动                                                   | 低   | M    | 后续如补翻译，只修改文案文件，不影响组件行为                                      |

## Notes (Optional)

- 本轮最重要的简化已经完成：删除了会话定位特有的 `compact` 逻辑，避免与 `AgentPlanOverlay` 产生双轨行为。
- `VirtualizedMessageThread` 暴露 `scrollToIndex` 的方向是对的；相比 DOM 锚点方案，这一层抽象降低了回归风险。
