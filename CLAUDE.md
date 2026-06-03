# Computer-Use Harness — 项目指引

## 实现前必读

在修改代码或编写新功能之前，按需读取：

1. **`CONTEXT.md`** — 项目上下文、核心理念、技术栈
2. **`docs/CAPABILITY-MATRIX.md`** — 能力矩阵和增强路线图
3. **`docs/engineering/conventions.md`** — 工程规范（编码约定、架构规则）
4. **当前活跃任务**（`docs/task/` 下按时间戳倒序，取最新的）：
   - `README.md` — 任务目标和计划
   - `progress.md` — 当前进展
   - `SUMMARY.md` — 完成总结

## 核心原则

### 1. 通用能力优先

**不要**为每个 App 写定制化逻辑。

**应该**实现可复用的 Capability，让所有 App 自动获益。

```typescript
// ❌ 错误示范：在 App Adapter 中实现查找逻辑
const qqMusicAdapter = {
  findElement(observation) {
    // 100 行查找逻辑...
  }
}

// ✅ 正确示范：实现通用 Capability
class AXElementFinder implements Capability {
  canHandle(action, observation) { /* ... */ }
  execute(action, observation) { /* ... */ }
}
```

### 2. Capability 可组合

Capabilities 通过 Chain 自动降级：

```
Action → CapabilityChain
  ├─ AXElementFinder canHandle? → 成功 ✓
  ├─ FirstResultClicker canHandle? → (跳过)
  └─ CoordinateClicker canHandle? → (跳过)
```

### 3. App Adapter 最小化

App Adapter **只做语义映射**，不实现逻辑：

```typescript
// ✅ 正确：只提供 semantic hints
const adapter = {
  semanticHints: {
    "click result": {
      coordinate: [{ relative: "搜索", x: 41, y: 208 }]
    }
  }
}

// ❌ 错误：实现查找逻辑（应该在 Capability 中）
```

## Git 提交规范

- Commit message: 动词开头，简洁描述变更
- 重大架构变更需要在 `docs/decisions/` 记录 ADR
- 每个 commit 应该是独立可运行的
- 使用 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` 标记 AI 协作

## 文档分层

| 层 | 位置 | 说明 |
|----|------|------|
| 项目指引 | CLAUDE.md, CONTEXT.md, README.md | 入口文档 |
| 工程标准 | docs/engineering/ | 跨任务长期有效 |
| 指南 | docs/guides/ | 如何添加 Capability/Adapter |
| 任务文档 | docs/task/{YYMMDD}-{name}/ | 架构、进度、决策 |
| ADR | docs/decisions/ | 架构决策记录 |

## 快速开始

### 添加新 Capability

1. 在 `src/capabilities/` 创建文件
2. 实现 `Capability` 接口
3. 注册到 `src/capabilities/index.ts`
4. 验证现有 usecases 仍然 PASSED

详见：`docs/guides/how-to-add-capability.md`

### 添加新 App

1. 在 `src/adapters/apps/{app-name}/` 创建 adapter.ts
2. 只提供必要的 semantic hints
3. 注册到 `src/adapters/apps/index.ts`
4. 创建 usecase 验证

详见：`docs/how-to-add-new-app.md`

## 测试

```bash
# 运行 usecase 验证
./dist/cli/index.js usecases run UC-100 --mac-helper ./native/mac-helper/.build/debug/computer-use-mac-helper

# 构建
npm run build

# (未来) 运行单元测试
npm test
```

## 关键决策历史

| 决策 | 文档 | 日期 |
|------|------|------|
| Capability 架构重构 | docs/task/260604-capability-architecture/ | 2026-06-03 |
| Vision extraction | docs/task/260605-vision-extraction/ | 2026-06-03 |
| P0 通用能力实现 | docs/task/260606-p0-capabilities/ | 2026-06-03 |
