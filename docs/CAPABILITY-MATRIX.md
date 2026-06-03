# Computer-Use Harness 能力矩阵

## 架构原则

**设计理念**：
- **通用能力优先**：可复用、可组合的底层能力
- **适配层最小化**：App-specific 逻辑只做语义映射，不实现查找
- **自由组合**：通用能力自动降级，适配层提供可选线索

上层软件数量不可枚举 → **通用能力 + 局部定制（semantic hints）**

---

## 第一层：通用能力（Capabilities）

### 1. 元素查找与交互

| Capability | 功能 | 适用场景 | 依赖 |
|-----------|------|---------|------|
| **AXElementFinder** | 通过 AX tree 查找元素（role + name + keyword） | AX 暴露良好的应用 | macOS Accessibility API |
| **FirstResultClicker** | 点击第一个可点击元素（Row/Cell） | AX tree 元素无 name 时降级 | macOS Accessibility API |
| **CoordinateClicker** | 固定坐标点击 | AX 完全不可用时兜底 | 窗口坐标 + semantic hints |
| **TextInputHandler** | 查找并输入文本框 | 通用文本输入场景 | macOS Accessibility API |

### 2. 信息提取与理解

| Capability | 功能 | 适用场景 | 依赖 |
|-----------|------|---------|------|
| **ScreenshotVisionCapability** | 截图 + Claude Vision 分析提取信息 | 任何可视化内容提取 | Swift screenshot + Claude API |
| *(未来) OCRCapability* | 纯文字 OCR 提取 | 文本密集场景 | Tesseract / Vision API |
| *(未来) LayoutAnalyzer* | 分析页面布局和区域 | 复杂 UI 理解 | Vision API + layout model |

### 3. 状态管理与验证

| Capability | 功能 | 适用场景 | 依赖 |
|-----------|------|---------|------|
| **FileSystemVerifier** | 读取文件系统验证操作结果 | 文件操作验证 | Node.js fs |
| *(未来) WaitForState* | 等待元素出现或状态变化 | 异步加载场景 | 轮询 + timeout |
| *(未来) DialogHandler* | 自动检测和处理对话框 | 跨应用对话框处理 | AX tree pattern matching |

### 4. 导航与规划

| Capability | 功能 | 适用场景 | 依赖 |
|-----------|------|---------|------|
| *(未来) NavigationPlanner* | 多步骤导航规划和验证 | 复杂 UI 导航 | LLM planning |
| *(未来) RetryStrategy* | 智能重试和错误恢复 | 操作失败时重试 | Policy + state tracking |

---

## 第二层：能力编排（Capability Chain）

### 自动降级策略

```
Action → CapabilityChain → 按优先级尝试
  ├─ Capability 1 canHandle? → try execute
  ├─ Capability 2 canHandle? → try execute  
  └─ Capability 3 canHandle? → try execute
```

**当前 Chain（按优先级）**：
1. `ScreenshotVisionCapability` - Extract actions
2. `TextInputHandler` - Type to search inputs
3. `AXElementFinder` - Click/Type with AX + keyword
4. `FirstResultClicker` - Click first result (fallback)
5. `CoordinateClicker` - Click at coordinates (last resort)

**扩展性**：
- 新增 Capability → 插入 Chain
- 调整优先级 → 重排序
- App-specific Chain → createCustomChain()

---

## 第三层：应用适配（App Adapters）

### 适配层职责（最小化）

**只做 3 件事**：
1. **PrepareUseCase**：准备环境（创建临时文件）
2. **BindActionInput**：注入语义输入（文件路径、按钮名）
3. **SemanticHints**：提供查找线索，不实现逻辑

**不做的事**：
- ❌ 不实现元素查找逻辑
- ❌ 不实现点击/输入逻辑
- ❌ 不处理降级策略

### 当前适配器

| App | 代码量 | Semantic Hints | 特殊逻辑 |
|-----|--------|----------------|----------|
| **QQ Music** | 18 行 | 坐标 hint（搜索面板"全部播放"） | 无 |
| **Sublime Text** | 140 行 | AX hints（Cancel 按钮、文档窗口） | 文件系统验证 |
| *(未来) VS Code* | ~20 行 | AX hints（菜单、输入框） | 无 |
| *(未来) Chrome* | ~30 行 | 无（通过 DevTools Protocol） | 无 |

### Semantic Hints 示例

```typescript
const qqMusicAdapter: AppAdapter = {
  appId: "com.tencent.qqmusicmac",
  semanticHints: {
    "click result": {
      // 当 AX 失败时的坐标降级
      coordinate: [{ relative: "搜索", x: 41, y: 208 }]
    }
  }
}
```

---

## 通用能力增强路线图

### P0 - 核心增强（立即需要）

1. **WaitForState Capability**
   - 等待元素出现/消失
   - 等待文本变化
   - 超时和轮询策略
   - **价值**：处理异步加载，提高成功率

2. **DialogHandler Capability**
   - 自动检测系统对话框
   - 识别常见模式（OK/Cancel/Save）
   - 自动处理或询问用户
   - **价值**：减少 App-specific 对话框处理代码

3. **NavigationVerifier Capability**
   - 多步骤操作后验证是否到达目标页面
   - 页面类型识别
   - 失败时自动回退和重试
   - **价值**：解决"周杰伦最新专辑"类问题

### P1 - 体验增强（下一步）

4. **LayoutAnalyzer Capability**
   - 使用 Vision 理解页面布局
   - 识别区域（导航栏、内容区、侧边栏）
   - 提供区域级别的操作
   - **价值**：处理复杂 UI，不依赖 AX

5. **SmartRetry Capability**
   - 记录失败原因
   - 尝试不同策略
   - 学习成功模式
   - **价值**：自适应提高成功率

6. **MultiModalInput Capability**
   - 组合键盘、鼠标、触控板
   - 拖拽操作
   - 手势支持
   - **价值**：支持更多交互方式

### P2 - 高级能力（长期）

7. **SemanticCache Capability**
   - 缓存 UI 元素位置
   - 记录成功的查找路径
   - 跨 session 复用
   - **价值**：提速重复操作

8. **CollaborativeAgent Capability**
   - 多个 agent 协作执行任务
   - 一个探索，一个验证
   - 并行尝试多种策略
   - **价值**：复杂任务成功率

---

## 能力组合示例

### 示例 1：搜索并提取信息

```
UC: "QQ Music 搜索周杰伦最新专辑"

Step 1: Type "周杰伦" 
→ TextInputHandler 找搜索框 + 输入

Step 2: Press Enter
→ 直接执行

Step 3: Wait for results
→ WaitForState 等待搜索结果加载（新增）

Step 4: Click "专辑" tab
→ AXElementFinder 找"专辑"按钮 → 失败
→ ScreenshotVision 识别 tab 位置 → 成功

Step 5: Verify navigation
→ NavigationVerifier 确认在专辑页（新增）

Step 6: Extract latest album
→ ScreenshotVision 截图 + 分析 → 返回结构化数据
```

### 示例 2：编辑保存文件

```
UC: "Sublime Text 编辑文件"

Step 1: Open file
→ 直接执行

Step 2: Handle registration dialog
→ DialogHandler 自动检测并关闭（新增）

Step 3: Type text
→ AXElementFinder 找文档窗口 + 输入

Step 4: Save
→ 快捷键

Step 5: Verify saved
→ FileSystemVerifier 读文件验证
```

---

## 设计原则验证

### ✅ 通用能力优先

| 原则 | 当前状态 | 证据 |
|------|---------|------|
| 可复用 | ✅ | FirstResultClicker 对所有 App 生效 |
| 可组合 | ✅ | CapabilityChain 自由调整优先级 |
| 可扩展 | ✅ | 新增 Capability 无需修改现有代码 |

### ✅ 适配层最小化

| 原则 | 当前状态 | 证据 |
|------|---------|------|
| 只做语义映射 | ✅ | QQ Music 只有 18 行 semantic hints |
| 不实现逻辑 | ✅ | 所有查找逻辑在 Capabilities 中 |
| 局部定制 | ✅ | 只在必要时添加 hints |

### ✅ 自由组合

| 原则 | 当前状态 | 证据 |
|------|---------|------|
| 自动降级 | ✅ | UC-101 证明：AX 失败 → FirstResult 成功 |
| 可选线索 | ✅ | Semantic hints 是可选的 |
| 无硬依赖 | ✅ | 零 adapter 代码也能工作 |

---

## 下一步行动

### 立即可做（增强通用能力）

1. **实现 WaitForState Capability**
   - 解决搜索结果加载延迟问题
   - ~30-50k tokens

2. **实现 NavigationVerifier Capability**
   - 解决"到达错误页面"问题
   - ~20-30k tokens

3. **实现 DialogHandler Capability**
   - 自动处理系统对话框
   - ~30-40k tokens

### 测试新能力

用 UC-102 验证：
- 加上 WaitForState → 等待搜索结果
- 加上 NavigationVerifier → 验证是否在专辑页
- 重新提取周杰伦最新专辑信息

---

**总结**：当前架构符合"通用能力 + 局部定制"原则，下一步重点是增强通用能力（等待、验证、对话框），而不是为每个 App 写适配器。
