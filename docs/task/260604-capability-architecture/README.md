# Task: Capability-based Architecture Refactor

## 目标

推倒重来，建立**分层能力 + 自动降级**架构，解决当前"每个 App 都要定制"的问题。

## 当前问题

1. **能力选择职责放错地方**：App Adapter 决定用 AX 还是坐标，无法复用
2. **无法自动降级**：AX 失败就失败了，不会自动尝试截图或坐标
3. **通用能力无法共享**：等待加载、截图识别等能力无法跨 App 复用
4. **新 App 接入成本高**：即使 AX 够用也要写 adapter

## 新架构设计

### Layer 1: Capability（能力层）

每个 capability 负责一种技术手段：

```typescript
interface Capability {
  name: string
  canHandle(action: Action, observation: Observation, hints?: SemanticHints): boolean
  execute(action: Action, observation: Observation, hints?: SemanticHints): Promise<CapabilityResult>
}
```

内置 capabilities：
- `AXElementFinder` - AX tree 查找元素
- `CoordinateClicker` - 固定坐标点击
- `WaitForState` - 等待状态变化
- (未来) `ScreenshotVisionFinder` - 截图 + vision 识别

### Layer 2: CapabilityChain（执行链）

按优先级尝试 capabilities，自动降级：

```typescript
const chain = [
  axElementFinder,      // 优先
  coordinateClicker,    // 降级
  // screenshotVision,  // 未来
]

for (const cap of chain) {
  if (cap.canHandle(action, observation, hints)) {
    return await cap.execute(action, observation, hints)
  }
}
```

### Layer 3: App Adapter（语义提供者）

只提供语义线索，不实现查找逻辑：

```typescript
interface AppAdapter {
  appId: string
  appName: string
  semanticHints?: SemanticHints
  prepareUseCase?(useCase: UseCase): Promise<void>
}

type SemanticHints = {
  [actionKey: string]: {
    ax?: { role?: string; name?: string; index?: number }[]
    coordinate?: { relative: string; x: number; y: number }[]
    vision?: { text: string; region?: string }[]
  }
}
```

## 实施计划

### Phase 1: Capability 抽象层
- [x] 定义 Capability 接口
- [ ] 实现 AXElementFinder
- [ ] 实现 CoordinateClicker
- [ ] 实现 WaitForState
- [ ] 实现 CapabilityChain

### Phase 2: 重构 native-runner
- [ ] executeNativeAction 改为查询 capability chain
- [ ] 移除直接调用 helper.click/type
- [ ] 保持 trace/policy 逻辑不变

### Phase 3: 重新设计 App Adapter
- [ ] 定义新的 AppAdapter 接口（只有 semanticHints）
- [ ] 迁移 QQ Music 到新模式
- [ ] 迁移 Sublime Text 到新模式

### Phase 4: 验证
- [ ] UC-100 PASSED
- [ ] UC-110 PASSED
- [ ] UC-101 PASSED（之前失败的）

## 验收标准

1. **自动降级生效**：UC-101 失败时自动尝试坐标方案
2. **通用能力复用**：等待逻辑不在 adapter 中，在 capability 中
3. **App Adapter 变薄**：只有 semanticHints，没有 bindElement 实现
4. **新 App 接入简单**：如果 AX 够用，零 adapter 代码

## Token 预算

预估 200-300k tokens，当前已用 ~128k，剩余充足。

## 启动

开始 Phase 1。
