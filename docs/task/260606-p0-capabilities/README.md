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
- [ ] 定义接口和配置
- [ ] 实现轮询逻辑
- [ ] 集成到 capability chain
- [ ] UC-102 验证

### Phase 2: NavigationVerifier  
- [ ] 定义验证策略
- [ ] Vision-based 页面识别
- [ ] 集成到 action pipeline
- [ ] UC-102 验证

### Phase 3: DialogHandler
- [ ] AX tree 对话框检测
- [ ] 常见模式匹配
- [ ] 自动处理逻辑
- [ ] UC-110 验证

## 验收标准

- [ ] UC-102 成功提取周杰伦专辑信息（解决导航问题）
- [ ] UC-110 自动处理注册对话框（无需 adapter 代码）
- [ ] 所有现有 UC 仍然 PASSED

## 启动

Phase 1: WaitForState
