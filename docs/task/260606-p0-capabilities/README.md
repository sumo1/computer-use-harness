# Task: Implement P0 Universal Capabilities

## 目标

实现 3 个核心通用能力，提升所有应用的操作成功率和可靠性。

## P0 Capabilities

### 1. WaitForState Capability
- 等待元素出现/消失
- 等待文本变化
- 超时和轮询策略
- 解决：异步加载、搜索结果延迟

### 2. NavigationVerifier Capability
- 验证是否到达目标页面
- 页面类型识别
- 失败时提供反馈
- 解决："周杰伦最新专辑"导航错误

### 3. DialogHandler Capability
- 自动检测系统对话框
- 识别常见模式（OK/Cancel/Save）
- 自动处理或询问用户
- 解决：减少 App-specific 对话框代码

## 实施计划

### Phase 1: WaitForState
- [x] 定义接口和配置
- [x] 实现轮询逻辑
- [x] 集成到 capability chain
- [ ] UC-102 真实 QQ 音乐验证

### Phase 2: NavigationVerifier  
- [x] 定义验证策略
- [ ] Vision-based 页面识别
- [x] 集成到 action pipeline
- [ ] UC-102 真实 QQ 音乐验证

### Phase 3: DialogHandler
- [x] AX tree 对话框检测
- [x] 常见模式匹配
- [x] 自动处理逻辑
- [ ] UC-110 验证

### Phase 4: Target Mode
- [x] UC-102 增加 `goal` 规格，保留旧 `steps` 兼容
- [x] 实现 `Goal -> Evidence -> NextAction -> Extraction` 目标循环
- [x] 将候选列表提取、按发布日期排序、详情页确认做成通用目标逻辑
- [x] fake helper 端到端覆盖 happy path 和 tab stalled 后滚动恢复
- [x] 真实 QQ 音乐端到端验证

## Target Mode 验收门禁

目标模式只有一个通过标准：完整 `usecases run` 端到端执行返回 `passed`，并且 trace 中存在最终 `targetModePhase=complete` 的 extract 结果。

能力级检查、候选提取检查、fake observation 片段检查只能作为诊断信号，不能单独把目标模式标记为通过。

本地 fake E2E 门禁：

```sh
npm run validate:target-mode:e2e
```

真实应用 E2E 门禁需要保存命令输出和 `tracePath`，UC-102 在真实 QQ 音乐里必须完成搜索、进入专辑候选详情页，并从详情页证据提取 `albumName`、`releaseDate`、`artist`。

真实 QQ 音乐验证记录：

- 命令：`dist/cli/index.js usecases run UC-102 --mac-helper native/mac-helper/.build/arm64-apple-macosx/debug/computer-use-mac-helper --pretty`
- 结果：`passed`
- trace：`trace_native_ad9aeff0-ce6c-41a7-898c-c6527f5a6bac`
- 最终提取：`{"albumName":"太阳之子","releaseDate":"2026-03-25","artist":"周杰伦","sourceEvidence":"source=detail; title=太阳之子; artist=周杰伦; releaseDate=2026-03-25"}`
- 人工核对截图：`/tmp/uc102-real-final-screens/23-click-tab-named-专辑.png`、`/tmp/uc102-real-final-screens/31-press-key-PageDown.png`

## 验收标准

- [x] UC-102 真实 QQ 音乐端到端成功提取周杰伦专辑信息（解决导航问题）
- [ ] UC-110 自动处理注册对话框（无需 adapter 代码）
- [ ] 所有现有 UC 仍然 PASSED

## 启动

Phase 1: WaitForState
