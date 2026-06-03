# Capability Architecture - Complete

## 状态

✅ **完成**

所有验收标准达成：
- UC-100 (QQ Music 鸭子): PASSED
- UC-110 (Sublime Text): PASSED
- UC-101 (QQ Music 周杰伦): PASSED（之前失败，现在成功）

## 架构改进

### 新增能力层

**Capabilities**:
- `AXElementFinder` - 使用 AX tree 查找元素（优先）
- `FirstResultClicker` - 点击第一个可点击结果（降级）
- `CoordinateClicker` - 固定坐标点击（兜底）
- `TextInputHandler` - 文本输入处理
- `CapabilityChain` - 自动降级执行器

**执行流程**:
```
Action → CapabilityChain
  ├─ 尝试 AXElementFinder → 失败
  ├─ 尝试 FirstResultClicker → 成功 ✓
  └─ (不需要继续尝试)
```

### App Adapter 简化

**QQ Music**:
- Before: 182 行（实现 bindElement、verification）
- After: 18 行（只有 semanticHints）
- 减少 90%

**Sublime Text**:
- Before: 200 行
- After: 140 行（保留文件验证 + semanticHints）
- 减少 30%

### 自动降级证明

UC-101 "搜索周杰伦"：
1. AXElementFinder 尝试找包含"周杰伦"的元素 → 失败（name 为空）
2. **自动降级**到 FirstResultClicker → 成功（点击第一个 Row）
3. Trace 记录：`capabilityUsed: "first-result-clicker"`

### 代码行数统计

新增：
- `src/capabilities/` - 5 个文件，~400 行
- 新 App Adapter 接口

简化：
- `src/usecases/native-runner.ts` - 使用 capability chain
- `src/adapters/apps/qq-music/adapter.ts` - 从 182 行减到 18 行
- `src/adapters/apps/sublime-text/adapter.ts` - 从 200 行减到 140 行

## 验收标准达成情况

| 标准 | 状态 | 证据 |
|------|------|------|
| 自动降级生效 | ✅ | UC-101 使用 first-result-clicker |
| 通用能力复用 | ✅ | FirstResultClicker 对所有 App 生效 |
| App Adapter 变薄 | ✅ | QQ Music -90%, Sublime Text -30% |
| 新 App 接入简单 | ✅ | AX 够用时零 adapter 代码 |
| UC-100 PASSED | ✅ | 8/8 步骤通过 |
| UC-110 PASSED | ✅ | 7/7 步骤通过，文件验证成功 |
| UC-101 PASSED | ✅ | 7/7 步骤通过（之前失败） |

## 核心价值

**问题**：每个 App 都要写定制化 adapter，无法复用，失败无降级

**解决**：
1. **分层能力**：AX → FirstResult → Coordinate
2. **自动降级**：一个方案失败自动尝试下一个
3. **能力复用**：所有 App 共享 FirstResultClicker
4. **Adapter 变薄**：只提供语义线索，不实现逻辑

## Token 消耗

Phase 1-4 全程约 65k tokens，高效完成。

## 下一步建议

1. 添加 `WaitForState` capability（等待元素出现）
2. 添加 `ScreenshotVision` capability（截图识别，未来）
3. 为更多 App 添加 semantic hints
4. 抽象 FileSystemVerifier 为通用 capability
