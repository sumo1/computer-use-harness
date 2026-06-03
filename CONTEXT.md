# Computer-Use Harness — 项目上下文

> 最后更新：2026-06-03
>
> 新人入手？从这里开始，然后看 [CLAUDE.md](CLAUDE.md) 和 [能力矩阵](docs/CAPABILITY-MATRIX.md)。

## 项目定位

Computer-Use Harness 是一个 **macOS 应用自动化框架**，通过分层能力架构实现跨应用的通用操作。

- 核心使命：让计算机能够像人一样操作 macOS 应用
- 设计理念：通用能力优先，适配层最小化
- 架构原则：可复用、可组合、自动降级

## 核心理念

### 三层架构

```
Layer 1: Capabilities（通用能力层）
├─ 可复用：一次实现，所有 App 受益
├─ 可组合：自由组合，按需使用
└─ 技术手段：AX Tree, 截图, Vision, 坐标

Layer 2: Capability Chain（自动降级层）
└─ 按优先级尝试，第一个成功即用

Layer 3: App Adapters（语义映射层）
├─ 最小化：只提供 semantic hints
└─ 不实现逻辑：所有查找逻辑在 Capability 中
```

### 设计原则

1. **通用能力优先**：不为每个 App 写定制逻辑
2. **适配层最小化**：App Adapter 只做语义映射
3. **自由组合**：Capabilities 可自由调整优先级
4. **自动降级**：一种方法失败自动尝试下一种

## 技术栈

| 技术 | 选择 | 说明 |
|------|------|------|
| 语言 | TypeScript (ES2023) | 类型安全 |
| 运行时 | Node.js 22+ | 现代 JS 特性 |
| macOS 集成 | Swift helper | 原生 Accessibility API |
| AI | Anthropic Claude API | Vision 和信息提取 |
| 构建 | tsc | 原生 TypeScript 编译 |
| 包管理 | npm | 标准工具链 |

## 核心概念

### Capability（能力）

通用操作能力，与具体 App 无关：

```typescript
interface Capability {
  name: string
  canHandle(action, observation, hints?): boolean
  execute(action, observation, hints?): Promise<CapabilityResult>
}
```

**当前已实现**：
1. WaitForState - 等待状态变化
2. NavigationVerifier - 验证导航
3. DialogHandler - 自动处理对话框
4. ScreenshotVision - 截图提取信息
5. TextInputHandler - 文本输入
6. AXElementFinder - AX tree 查找
7. FirstResultClicker - 点击第一个结果
8. CoordinateClicker - 坐标点击

### App Adapter（适配器）

提供 App-specific 的语义线索：

```typescript
interface AppAdapter {
  appId: string
  appName: string
  semanticHints?: SemanticHints  // 可选的查找线索
  prepareUseCase?(): Promise<void>
  bindActionInput?(): Action
  verifyAction?(): Promise<ActionResult>
}
```

**关键**：不实现查找逻辑，只提供线索。

### UseCase（用例）

描述完整的自动化场景：

```yaml
- id: UC-100
  title: Search and play Duck in QQ Music
  steps:
    - open app
    - type 鸭子 into search input
    - press key Enter
    - click result named 鸭子
```

## 架构全景

```
┌─────────────────────────────────────────┐
│          User / Claude Agent             │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│         CLI / UseCase Runner             │
│  (usecases/native-runner.ts)            │
└────────────────┬────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
┌───────▼───────┐  ┌──────▼──────┐
│ Capability    │  │ App Adapter │
│ Chain         │  │ (optional)  │
│ (8 caps)      │  │ hints only  │
└───────┬───────┘  └─────────────┘
        │
        │ 按优先级尝试
        ├─ WaitForState
        ├─ NavigationVerifier
        ├─ DialogHandler
        ├─ ScreenshotVision
        ├─ TextInputHandler
        ├─ AXElementFinder
        ├─ FirstResultClicker
        └─ CoordinateClicker
                 │
        ┌────────▼────────┐
        │  Swift Helper   │
        │  (macOS Native) │
        └─────────────────┘
```

## 当前工程边界

### 已实现

- ✅ 8 个通用 Capabilities
- ✅ 自动降级 Capability Chain
- ✅ QQ Music 和 Sublime Text adapters
- ✅ 真实截图 + Vision extraction
- ✅ 5 个验证的 usecases (UC-100, 101, 102, 103, 110)

### 进行中

- 🔄 UC-102 增强（使用 Wait 和 Navigation 能力）
- 🔄 工程规范文档化

### 未来方向

见 `docs/CAPABILITY-MATRIX.md` P1/P2 路线图：
- LayoutAnalyzer
- SmartRetry
- MultiModalInput
- SemanticCache

## 文档导航

| 入口 | 路径 | 说明 |
|------|------|------|
| **项目指引** | [CLAUDE.md](CLAUDE.md) | 实现前必读 |
| **能力矩阵** | [docs/CAPABILITY-MATRIX.md](docs/CAPABILITY-MATRIX.md) | 能力清单和路线图 |
| **架构审查** | [docs/ARCHITECTURE-REVIEW.md](docs/ARCHITECTURE-REVIEW.md) | 架构合理性分析 |
| **添加 App** | [docs/how-to-add-new-app.md](docs/how-to-add-new-app.md) | App 接入指南 |
| **任务记录** | [docs/task/](docs/task/) | 历史任务文档 |

## 关键度量

| 指标 | 当前值 | 说明 |
|------|--------|------|
| Capabilities | 8 个 | 通用能力数量 |
| App Adapters | 2 个 | QQ Music, Sublime Text |
| App Adapter 代码量 | < 20 行 | QQ Music 只有 18 行 |
| Usecases | 5 个 | 全部 PASSED |
| 代码简化 | -50% | native-runner 从 549 行减到 276 行 |

## 产品哲学

**"不要为每个 App 写适配器，要让通用能力足够强大。"**

当你想为某个 App 添加特殊逻辑时，先问：
1. 这个需求对其他 App 也适用吗？
2. 能否抽象成通用 Capability？
3. App Adapter 真的需要这个逻辑吗？

90% 的情况下，答案是"应该做成通用 Capability"。
