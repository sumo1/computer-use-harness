# Task: Refactor to App Adapter Pattern

## 目标

在接入第 3 个 App 之前，将当前散布的 app-specific 逻辑重构为统一的 App adapter 模式，并抽象通用能力（FileSystemVerifier、DialogHandler）。

## 背景

当前 QQ Music 和 Sublime Text 的特化逻辑散布在：
- `src/usecases/native-runner.ts` - bindElement 中的 if 分支
- `src/usecases/sublime-text.ts` - Sublime 专用逻辑
- `native/mac-helper/Sources/ComputerUseMacHelper/main.swift` - isQQMusicTarget / isSublimeTextTarget 和各自 fallback

随着 App 数量增长，这会导致：
- bindElement 函数持续膨胀
- 新 App 接入需要修改多个文件
- App 特化逻辑缺乏统一接口

## 验收标准

### 1. App Adapter 模式

- [x] 定义 `AppAdapter` 接口
- [x] 创建 `src/adapters/apps/` 目录结构
- [x] 迁移 QQ Music 到 `src/adapters/apps/qq-music/adapter.ts`
- [x] 迁移 Sublime Text 到 `src/adapters/apps/sublime-text/adapter.ts`
- [x] 建立 app registry：bundle ID → adapter
- [x] `native-runner` 通过 registry 查找和调用 adapter
- [x] UC-100 和 UC-110 仍然 PASSED

### 2. 抽象通用能力

- [x] `FileSystemVerifier` 独立模块
- [x] Sublime Text adapter 使用 FileSystemVerifier
- [x] UC-110 文件验证仍然 PASSED

### 3. 文档更新

- [x] 更新架构文档说明新的 adapter 模式
- [x] 添加"如何接入新 App"指南

## 非目标

- Swift 侧的重构（留待后续）
- DialogHandler 抽象（UC-110 对话框处理暂时保持现状）
- 通用 element binding 策略抽象（需要更多 App 数据点）

## 实施计划

### Phase 1: 定义接口和基础设施

1. 定义 `AppAdapter` 接口
2. 创建 app registry 模块
3. 创建 `src/adapters/apps/` 目录结构

### Phase 2: 迁移 Sublime Text

1. 创建 `src/adapters/apps/sublime-text/adapter.ts`
2. 迁移 `sublime-text.ts` 的逻辑
3. 抽象 FileSystemVerifier
4. 更新 native-runner 使用 adapter
5. 验证 UC-110 PASSED

### Phase 3: 迁移 QQ Music

1. 创建 `src/adapters/apps/qq-music/adapter.ts`
2. 迁移 native-runner 中的 QQ Music 逻辑
3. 更新 native-runner 使用 adapter
4. 验证 UC-100 PASSED

### Phase 4: 清理和文档

1. 删除旧的 `sublime-text.ts`
2. 清理 native-runner 中的 app-specific 分支
3. 更新架构文档
4. 编写"如何接入新 App"指南

## 风险和缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 重构破坏现有 usecase | High | 每个 phase 后立即验证 UC-100/UC-110 |
| 接口设计不够通用 | Medium | 基于两个真实 App 的需求设计，保持 YAGNI 原则 |
| Swift 侧和 TS 侧不一致 | Low | 本次只重构 TS 侧，Swift 侧保持现状 |

## 时间估算

- Phase 1: ~15 min
- Phase 2: ~30 min
- Phase 3: ~25 min
- Phase 4: ~10 min

总计：~80 min

## 启动

准备开始 Phase 1。
