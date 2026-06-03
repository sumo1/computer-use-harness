# 接入新 App 的经验

从 QQ Music 和 Sublime Text 两个真实闭环中提取的关键经验。

## 核心判断

**不同 App 对 AX 的支持程度差异巨大。**

- QQ Music: 搜索框是 `AXUnknown`，无法通过标准 AXValue 设置文本
- Sublime Text: 文本编辑区完全不暴露 AX 文本输入元素

**不要假设"标准 AX 路径"一定能用。App-specific fallback 不是特例，而是常态。**

## 文本输入的三种模式

### 1. 标准 AXValue (最理想，很少见)

适用于暴露 AXTextField / AXTextArea 且 AXValue settable 的元素。

```swift
AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFTypeRef)
```

### 2. Focus + Paste (最通用)

适用于大部分自绘文本输入控件。

```swift
// 1. 激活 app
activateTargetApp(app)
// 2. 如果有可点击元素，点击聚焦（QQ Music）
clickElementCenterToHidWhenFrontmost(element, pid: app.processIdentifier)
// 3. 延迟等待聚焦生效
usleep(200_000)
// 4. 通过剪贴板粘贴
pasteTextToPid(app.processIdentifier, text: text)
```

Sublime Text 不需要步骤 2，因为窗口激活后文档自动获得焦点。

### 3. 逐字符 HID 事件 (最慢，最兼容)

适用于连 paste 都不支持的极端情况（目前未遇到）。

## 验证策略

### AX tree 验证 (快但不可靠)

适用于：
- 播放状态（检查"暂停"按钮出现）
- 搜索结果展示（检查结果列表包含预期文本）

**不适用于**：
- 文件保存（AX tree 不反映磁盘状态）
- 网络请求完成（AX tree 不反映后端状态）
- 数据持久化（AX tree 是 UI 快照，不是数据快照）

### 文件系统验证 (慢但可靠)

适用于：
- 文件创建/修改/删除
- 文件内容比对

```typescript
const content = await readFile(filePath, "utf8")
if (content === expectedText) {
  return passedResult()
}
```

Sublime Text UC-110 使用此方法验证保存成功。

### 外部观察验证 (最可靠，最贵)

适用于：
- 截图比对（视觉验证）
- 网络请求抓包（API 调用验证）
- 数据库查询（持久化验证）

目前未实现，但预留了 verifier 扩展点。

## App-specific 逻辑的组织

### 当前模式（适合 2-3 个 App）

**TS 侧**：
- `src/usecases/{app-name}.ts` - 准备、绑定、验证逻辑
- `src/usecases/native-runner.ts` - `bindElement` 中调用 app-specific 逻辑

**Swift 侧**：
- `is{AppName}Target` helper
- `performType` / `performClick` 中的 if 分支

### 推荐模式（3+ 个 App）

**TS 侧**：
- `src/adapters/apps/{app-name}/adapter.ts` - 实现 `AppAdapter` 接口
- `src/adapters/apps/registry.ts` - 注册表，bundle ID -> adapter
- `native-runner` 查表调用，不再堆 if

**Swift 侧**：
- 定义 handler 协议
- 每个 app 一个 handler 实现
- 注册表映射 bundle ID -> handler
- 通用路径查表调用

**触发点**：在接入第 3 个 App 之前重构。

## 对话框处理

### 当前模式（手动显式处理）

Sublime Text 的注册对话框作为显式步骤写在 usecase 中：
- `dismiss registration dialog if present`
- `focus document window`

**优点**：trace 明确记录了对话框处理过程。

**缺点**：每个 usecase 都要记得加这些步骤。

### 推荐模式（自动后台处理）

App adapter 声明已知对话框和关闭策略：

```typescript
knownDialogs: [
  {
    title: "This is an unregistered copy",
    action: "click",
    buttonName: "Cancel"
  }
]
```

`native-runner` 在每次 observation 后自动检测和关闭。对话框关闭记录在 trace 的 metadata 中，但不占用 usecase step。

## Element binding 策略

### 优先级

1. **精确匹配**：AX identifier / role + title
2. **语义匹配**：role + name 包含关键词
3. **结构匹配**：父元素 + 子元素位置
4. **坐标匹配**：固定坐标（最后手段，QQ Music "全部播放"按钮）

### 何时用固定坐标

**仅当**：
- AX tree 完全不暴露目标元素
- 元素位置在该 app 的所有窗口尺寸下都稳定
- 坐标是相对于容器，而不是屏幕绝对坐标

QQ Music 的"全部播放"按钮：
```typescript
{
  x: frame.x + 41,  // 相对于"搜索"面板
  y: frame.y + 208,
}
```

**不要用绝对坐标**，窗口移动后会失效。

## Policy 要点

- **默认策略是 allowed**：除非明确 blocked，否则允许
- **blocked targets**：终端、系统设置、Claude Code 自身
- **policy decision 先于 action**：blocked 的 action 不会到达 helper
- **decision 写入 trace**：可审查

未来扩展：
- `requiresConfirmation` 状态（需要用户确认）
- 基于时间窗口的限流（防止误操作循环）

## Trace 设计原则

**Trace 不是调试附属品，而是核心产品能力。**

每个 trace 必须能回答：
- 当时 target 是谁？
- 观察来自哪里？
- policy 为什么允许或拒绝？
- action 走哪个 adapter？
- 失败码是什么？
- 下一次怎么复现？

**验证证据必须进 trace**：
- QQ Music: `metadata.verifier = "qqmusic-duck-playback"`
- Sublime Text: `metadata.verifier = "sublime-text-file-content"`

没有 trace 的 computer-use，只是一次性魔法。

## 最重要的一条

**在写代码前，先问：如果这一步失败了，我怎么证明它失败了？**

如果答案是"看 AX tree"，那不够。
如果答案是"看文件系统 / 截图 / 网络请求"，那才可靠。
