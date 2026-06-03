# Computer-Use Harness — 工程规范

> 本仓库的全局编码约定和架构规则。跨任务长期有效。

---

## 1. 技术栈

TypeScript + Node.js 22+ + Swift (macOS Helper) + Anthropic Claude API

包管理：npm（`package-lock.json` + `npm ci`）

---

## 2. 目录结构约定

```
src/
├── capabilities/    — 通用能力（与 App 无关）
├── adapters/        — 适配器
│   ├── apps/        — App-specific 适配器（最小化）
│   └── mac/         — macOS helper 客户端
├── cli/             — 命令行入口
├── core/            — 核心契约、类型、错误
├── runtime/         — 运行时逻辑（policy, trace）
└── usecases/        — 用例定义和执行

docs/
├── engineering/     — 工程标准
├── guides/          — 指南文档
├── task/            — 任务文档（按时间戳）
└── decisions/       — 架构决策记录（ADR）

native/
└── mac-helper/      — Swift helper
```

---

## 3. Capability 编写规范

### 3.1 命名规范

- 文件名：`{purpose}-{type}.ts`（如 `wait-for-state.ts`）
- 类名：`{Purpose}{Type}Capability`（如 `WaitForStateCapability`）
- name 属性：kebab-case（如 `"wait-for-state"`）

### 3.2 接口实现

每个 Capability 必须实现：

```typescript
export class XxxCapability implements Capability {
  readonly name = "xxx"
  
  canHandle(action, observation, hints?): boolean {
    // 判断是否能处理这个 action
  }
  
  async execute(action, observation, hints?): Promise<CapabilityResult> {
    // 执行并返回结果
  }
}
```

### 3.3 通用性原则

**必须**：
- ✅ 与具体 App 无关
- ✅ 可复用于所有场景
- ✅ 单一职责

**禁止**：
- ❌ 包含 App-specific 逻辑
- ❌ 硬编码 App 名称或 bundle ID
- ❌ 依赖特定 App 的 UI 结构

### 3.4 注册

在 `src/capabilities/index.ts` 中注册：

```typescript
export function createDefaultCapabilityChain(...): CapabilityChain {
  return new CapabilityChain([
    new YourCapability(),  // 按优先级排序
    // ...
  ])
}
```

---

## 4. App Adapter 规范

### 4.1 职责边界

App Adapter **只做 3 件事**：

1. **PrepareUseCase**: 准备环境（创建临时文件）
2. **BindActionInput**: 注入语义输入（文件路径、按钮名）
3. **SemanticHints**: 提供查找线索

**禁止**：
- ❌ 实现元素查找逻辑（应该在 Capability 中）
- ❌ 实现点击/输入逻辑
- ❌ 处理降级策略

### 4.2 代码量约束

- 目标：< 50 行（除非有复杂的外部验证）
- QQ Music adapter: 18 行（参考标准）
- Sublime Text adapter: 140 行（含文件系统验证）

### 4.3 SemanticHints 格式

```typescript
const semanticHints: SemanticHints = {
  "action description": {
    ax: [{ role: "AXButton", name: "OK" }],
    coordinate: [{ relative: "window", x: 100, y: 50 }],
    vision: [{ text: "contains OK", region: "dialog" }]
  }
}
```

---

## 5. 命名规范

### 5.1 文件命名

- 全部使用 **kebab-case**: `wait-for-state.ts`, `native-runner.ts`
- Capability: `{purpose}-{type}.ts`
- Adapter: `src/adapters/apps/{app-name}/adapter.ts`

### 5.2 导出命名

- Class: PascalCase (`WaitForStateCapability`)
- Interface: PascalCase (`Capability`, `AppAdapter`)
- Function: camelCase (`createDefaultCapabilityChain`)
- Const: camelCase (`qqMusicAdapter`)

---

## 6. 错误处理

### 6.1 Capability 错误

返回 `CapabilityResult`:

```typescript
// 成功
return {
  success: true,
  element: foundElement,
  metadata: { source: "capability-name" }
}

// 失败
return {
  success: false,
  reason: "Clear error message"
}
```

### 6.2 不要吞异常

**禁止**:
```typescript
try {
  await doSomething()
} catch (e) {
  console.log(e)  // ❌ 吞异常
  return null
}
```

**正确**:
```typescript
try {
  await doSomething()
} catch (e) {
  return {
    success: false,
    reason: error instanceof Error ? error.message : String(error)
  }
}
```

---

## 7. 测试规范

### 7.1 UseCase 测试

每个新 Capability 必须:
- 验证现有 usecases 仍然 PASSED
- 添加新 usecase 演示该能力

```bash
./dist/cli/index.js usecases run UC-XXX --mac-helper ...
```

### 7.2 单元测试（未来）

- 使用 Vitest
- Capability 需要单元测试
- Mock MacHelperClient

---

## 8. Git 规范

### 8.1 Commit Message

格式：`<verb> <what> [(<scope>)]`

```
Add WaitForState capability
Refactor capability chain priority
Fix element finding in DialogHandler
```

### 8.2 Commit 原则

- 每个 commit 应该独立可运行
- 构建必须通过（`npm run build`）
- 现有 usecases 必须 PASSED

### 8.3 Co-Authoring

AI 协作的 commit 使用：

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## 9. 文档规范

### 9.1 任务文档

新任务在 `docs/task/{YYMMDD}-{name}/`:

```
docs/task/260606-xxx/
├── README.md      — 任务目标和计划
├── progress.md    — 当前进展
└── SUMMARY.md     — 完成总结
```

### 9.2 ADR (Architecture Decision Record)

重大架构决策记录在 `docs/decisions/`:

```
docs/decisions/
└── 001-capability-architecture.md
```

格式：
```markdown
# ADR-001: Capability Architecture

## 状态
已接受

## 背景
...

## 决策
...

## 后果
...
```

---

## 10. 禁止事项

1. ❌ 在 Capability 中硬编码 App 名称
2. ❌ 在 App Adapter 中实现查找逻辑
3. ❌ 提前创建"可能未来会用"的空壳代码
4. ❌ 吞异常不报错
5. ❌ 魔法数字和魔法字符串（使用常量）
6. ❌ 超过 50 行的 App Adapter（除非有充分理由）
7. ❌ Commit 导致构建失败或测试失败

---

## 11. 代码审查检查清单

提交前自查：

- [ ] 构建通过（`npm run build`）
- [ ] 现有 usecases 全部 PASSED
- [ ] 新增 Capability 已注册到 Chain
- [ ] App Adapter 代码量 < 50 行
- [ ] 无硬编码 App 名称
- [ ] 错误处理正确
- [ ] 文件命名符合规范
- [ ] 有必要的注释

---

## 12. 性能规范

### 12.1 等待超时

- 默认超时：10 秒
- 轮询间隔：500 毫秒
- 可配置：通过 action.input.timeout

### 12.2 截图

- 格式：PNG (base64)
- 尺寸：窗口原始尺寸
- 缓存：不缓存（每次重新截图）

---

## 13. 安全规范

### 13.1 API Key

- 通过环境变量传递：`ANTHROPIC_API_KEY`
- 不硬编码在代码中
- 不提交到 git

### 13.2 敏感数据

- 不在日志中输出 API key
- 截图可能包含敏感信息（注意使用场景）

---

## 附录：参考资源

- Capability 示例：`src/capabilities/wait-for-state.ts`
- Adapter 示例：`src/adapters/apps/qq-music/adapter.ts`
- UseCase 示例：`usecases/cases.yaml`
