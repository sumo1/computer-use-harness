# Computer-Use Harness 架构审查

参考 medeo-market 工程理念，审查 computer-use-harness 架构的合理性。

## medeo-market 核心理念（参考标准）

### 1. 文档分层清晰
- **CLAUDE.md**: 实现前必读指引
- **CONTEXT.md**: 项目上下文汇总
- **docs/engineering/**: 工程标准和规范
- **docs/task/{YYMMDD}-{name}/**: 任务文档（架构、进度、决策）
- **docs/knowledge/**: 跨任务共享知识

### 2. 代码分层原则
```
src/
├── domain/      — 领域模型（纵向品类）
├── service/     — 业务逻辑
├── repository/  — 数据访问
├── http/        — HTTP 入口
├── infra/       — 基础设施
├── shared/      — 共享工具
└── config/      — 配置
```

### 3. 工程原则
- **单一职责**：每个模块职责清晰
- **依赖倒置**：高层不依赖低层实现
- **明确边界**：不为"以后可能"提前创建空壳
- **文档驱动**：重大决策有 ADR，任务有完整文档

---

## computer-use-harness 当前架构

### 目录结构

```
src/
├── adapters/       — 适配器层
│   ├── apps/       — App-specific 适配器
│   └── mac/        — macOS helper 客户端
├── capabilities/   — 通用能力层
├── cli/            — 命令行入口
├── core/           — 核心契约和错误
├── runtime/        — 运行时（policy）
└── usecases/       — 用例定义和执行

docs/
├── CAPABILITY-MATRIX.md
├── FINAL-SUMMARY.md
├── how-to-add-new-app.md
└── task/           — 任务文档（按时间戳）
```

---

## 架构对齐分析

### ✅ 已对齐的理念

| 理念 | medeo-market | computer-use-harness | 状态 |
|------|--------------|----------------------|------|
| 分层架构 | domain/service/repository | capabilities/adapters/usecases | ✅ 清晰 |
| 单一职责 | 每层职责明确 | capabilities 可组合，adapters 只做语义 | ✅ 良好 |
| 任务文档 | docs/task/{YYMMDD}-{name}/ | docs/task/{YYMMDD}-{name}/ | ✅ 一致 |
| 不做空壳 | 禁止提前创建未用代码 | 实现后才添加 | ✅ 遵守 |

### ⚠️ 需要改进的地方

| 问题 | 当前状态 | 应该做什么 |
|------|---------|----------|
| **缺少 CLAUDE.md** | ❌ 无 | ✅ 创建实现前必读指引 |
| **缺少 CONTEXT.md** | ❌ 无 | ✅ 创建项目上下文汇总 |
| **缺少工程规范** | ❌ 无 | ✅ 创建 docs/engineering/conventions.md |
| **文档散乱** | ⚠️ 多个总结文档分散 | ✅ 整合到标准位置 |
| **命名不统一** | ⚠️ `src/adapters/mac/` vs `src/capabilities/` | ✅ 考虑统一为 `-` 或驼峰 |
| **缺少 README.md** | ❌ 根目录无 README | ✅ 添加项目介绍 |

---

## 推荐的架构调整

### 1. 文档结构对齐

```
docs/
├── README.md                    — 文档导航（新增）
├── engineering/                 — 工程标准（新增）
│   ├── conventions.md          — 编码规范、架构约定
│   ├── architecture.md         — 架构设计文档
│   └── testing.md              — 测试规范
├── guides/                      — 指南（重组现有）
│   ├── how-to-add-capability.md
│   ├── how-to-add-app-adapter.md
│   └── capability-matrix.md
├── task/{YYMMDD}-{name}/       — 任务文档（保持）
└── decisions/                   — ADR（新增）
    └── 001-capability-architecture.md
```

### 2. 根目录添加指引文档

**CLAUDE.md**:
```markdown
# Computer-Use Harness — 项目指引

## 实现前必读

1. **docs/engineering/conventions.md** — 工程规范
2. **docs/guides/capability-matrix.md** — 能力矩阵
3. **当前活跃任务** — docs/task/ 按时间戳最新的

## 核心原则

- 通用能力优先，不为每个 App 写定制逻辑
- Capability 可复用、可组合
- App Adapter 只提供 semantic hints，不实现逻辑
```

**CONTEXT.md**:
```markdown
# Computer-Use Harness — 项目上下文

## 项目定位

macOS 应用自动化框架，通过分层能力架构实现跨应用的通用操作。

## 核心理念

- Layer 1: Capabilities（通用能力）
- Layer 2: Capability Chain（自动降级）
- Layer 3: App Adapters（语义映射）

## 技术栈

- 语言: TypeScript
- 运行时: Node.js 22+
- macOS 集成: Swift helper
- AI: Anthropic Claude API
```

### 3. 代码命名规范统一

**当前混乱**：
- `src/adapters/mac/stdio-helper-client.ts` (kebab-case)
- `src/capabilities/screenshot-vision.ts` (kebab-case)
- `src/usecases/native-runner.ts` (kebab-case)

**建议**：全部使用 kebab-case（已经基本统一，保持即可）

### 4. 添加工程规范文档

**docs/engineering/conventions.md**:
```markdown
# 工程规范

## 1. 目录结构约定

- `src/capabilities/`: 通用能力，与 App 无关
- `src/adapters/apps/`: App-specific 适配器，最小化
- `src/core/`: 核心契约、类型、错误定义
- `src/runtime/`: 运行时逻辑（policy, trace）

## 2. Capability 编写规范

- 每个 Capability 一个文件
- 实现 `canHandle()` 和 `execute()` 接口
- 命名: {purpose}-{type}.ts (如 wait-for-state.ts)
- 必须是通用的，不包含 App-specific 逻辑

## 3. App Adapter 规范

- 只提供 semanticHints，不实现查找逻辑
- 代码量应 < 50 行（除非有复杂验证）
- 命名: src/adapters/apps/{app-name}/adapter.ts

## 4. 测试规范

- Capability 需要单元测试
- UseCase 需要集成测试
- 使用 Vitest

## 5. Git 规范

- Commit message: 动词开头，简洁描述
- 重大架构变更需要 ADR
- 每个 commit 应该是独立可运行的
```

---

## 具体行动清单

### P0 - 立即执行

1. ✅ 创建 **CLAUDE.md** - 实现前必读指引
2. ✅ 创建 **CONTEXT.md** - 项目上下文汇总
3. ✅ 创建 **README.md** - 根目录项目介绍
4. ✅ 创建 **docs/engineering/conventions.md** - 工程规范

### P1 - 短期改进

5. ✅ 重组文档结构
   - docs/guides/ 存放指南
   - docs/decisions/ 存放 ADR
   - 整合现有散乱文档

6. ✅ 添加架构图
   - 用 mermaid 或 ASCII 表达层次关系
   - 放在 docs/engineering/architecture.md

### P2 - 长期优化

7. ⚠️ 添加测试
   - Capability 单元测试
   - UseCase 集成测试

8. ⚠️ 添加 CI/CD
   - 自动运行测试
   - 自动构建

---

## 总结

### 当前架构评分：7.5/10

**优点**：
- ✅ 分层清晰（Capability / Adapter / UseCase）
- ✅ 单一职责良好
- ✅ 任务文档完整
- ✅ 代码质量高

**待改进**：
- ❌ 缺少入口指引文档（CLAUDE.md, CONTEXT.md）
- ❌ 缺少工程规范文档
- ⚠️ 文档散乱，需要重组
- ⚠️ 缺少测试

### 对齐 medeo-market 后预期：9/10

通过添加指引文档和工程规范，架构将更加规范和易于协作。
