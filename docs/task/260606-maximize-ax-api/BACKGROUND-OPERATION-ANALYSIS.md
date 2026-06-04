# Codex 后台操作能力分析

## 核心发现：LSUIElement + Accessibility API

### 1. LSUIElement = true

**在两个组件的 Info.plist 中都发现**：
```json
{
  "LSUIElement": true
}
```

**LSUIElement 的作用**：
- ✅ 应用可以在后台运行
- ✅ 不会出现在 Dock
- ✅ 不会在 Cmd+Tab 中显示
- ✅ 不需要获得焦点就能操作
- ✅ 用户的前台应用不受影响

**这就是关键**！

---

## macOS Accessibility API 的后台能力

### AX API 的特性

**macOS Accessibility API 的设计初衷**：
- 为辅助技术服务（屏幕阅读器、语音控制）
- 这些辅助工具需要：
  - ✅ 在后台运行
  - ✅ 读取其他应用的 UI 信息
  - ✅ 操作其他应用的 UI 元素
  - ✅ 不干扰用户的正常使用

**核心能力**：
```swift
// 读取其他应用的 AX tree（不需要前台）
let app = AXUIElementCreateApplication(pid)
AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, ...)

// 点击其他应用的元素（不需要前台）
AXUIElementPerformAction(element, kAXPressAction)
```

### 关键差异：AX vs 鼠标点击

#### 方式 1：AX Action（后台）
```swift
// 通过 AX API 点击按钮
let button = findElement(...)
AXUIElementPerformAction(button, kAXPressAction)

// ✅ 不需要目标应用在前台
// ✅ 不需要移动真实鼠标
// ✅ 不干扰用户当前操作
// ✅ 系统会自动将 action 发送到目标应用
```

#### 方式 2：CGEvent 鼠标点击（需要前台或特殊权限）
```swift
// 通过模拟鼠标点击
let event = CGEventCreateMouseEvent(nil, .leftMouseDown, point, .left)
CGEventPost(.cghidEventTap, event)

// ❌ 目标应用通常需要在前台
// ❌ 会移动真实鼠标（干扰用户）
// ❌ 坐标需要精确对应
```

---

## Codex 的实现策略

### 混合使用两种方式

基于二进制分析，Codex 同时使用：

#### 1. 优先使用 AX Actions（后台操作）
```swift
// 当 element_index 可用时
if let element = findElementByIndex(index) {
    // 使用 AX action 点击
    AXUIElementPerformAction(element, kAXPressAction)
    // ✅ 后台操作
    // ✅ 不干扰用户
}
```

#### 2. 降级到坐标点击（需要前台）
```swift
// 当只有 x,y 坐标时
if needActivate {
    // 激活目标应用到前台
    app.activate()
}
// 使用 CGEvent 点击坐标
CGEventPost(...)
```

**这解释了**：
- Codex 对话中提到"QQ 音乐正在前台运行"
- 说明 Codex 确实会激活目标应用
- 但优先使用后台 AX 操作

---

## 为什么后台操作合理？

### 1. 设计理念：辅助技术

Accessibility API 就是为此设计的：
- 屏幕阅读器需要在后台读取 UI
- 语音控制需要在后台操作 UI
- 这是 macOS 的核心功能，不是 hack

### 2. 用户体验

**后台操作的好处**：
- ✅ 用户可以继续工作
- ✅ Codex 在后台帮忙查信息
- ✅ 不打断用户的流程
- ✅ 类似"助手"的体验

**如果必须前台**：
- ❌ 用户正在写文档
- ❌ Codex 强制切到 QQ Music
- ❌ 用户被打断
- ❌ 体验很差

### 3. 安全性

macOS 通过权限控制：
- 需要"辅助功能"权限
- 需要"屏幕录制"权限
- 用户明确授权才能使用
- 系统有完整的审计日志

---

## 你观察到的"图标和鼠标可以点击"

### 可能的实现方式

#### 假设 1：浮动窗口 + AX 操作
```swift
// 1. Codex 创建一个浮动窗口（overlay）
let overlayWindow = NSWindow(...)
overlayWindow.level = .floating  // 总是在最上层
overlayWindow.isOpaque = false   // 透明背景

// 2. 在窗口上绘制光标图标
overlayWindow.contentView = CursorView(at: targetPoint)

// 3. 用户看到光标图标，但实际点击是 AX action
AXUIElementPerformAction(targetElement, kAXPressAction)
```

**效果**：
- 用户看到"虚拟光标"在移动
- 但实际是 overlay 窗口上的图标
- 真正的操作是后台 AX action
- 用户的真实鼠标不受影响

#### 假设 2：只在 Codex 界面显示
```
Codex 窗口：
  [截图预览]
  └─ [光标图标 overlay at (x,y)]
  
实际操作：
  后台 AX action 点击目标应用
```

用户在 Codex 窗口中看到"要点哪里"，但操作是后台进行的。

---

## 对比：我们的实现

### 当前问题

**我们的 native-runner.ts 可能需要前台**：
```swift
// 如果使用坐标点击
clickElementCenterToPid(element, pid)
// 这可能需要应用在前台
```

### 我们可以做的

#### 1. 优先使用 AX Actions
```swift
// 当有 element_index 时
if let element = resolveElement(index) {
    // 使用 AX action（后台）
    AXUIElementPerformAction(element, kAXPressAction)
}
```

#### 2. 需要时才激活应用
```swift
// 只有在使用坐标点击时才激活
if useCoordinateClick {
    app.activate()
    // 短暂延迟确保激活
    usleep(200000)  // 200ms
    // CGEvent 点击
}
```

#### 3. 操作后可以切回用户的前台应用
```swift
// 记录当前前台应用
let previousApp = NSWorkspace.shared.frontmostApplication

// 执行操作
performAction(...)

// 切回用户的应用
previousApp?.activate()
```

---

## 合理性评估

### ✅ 完全合理

**原因 1：设计初衷**
- Accessibility API 就是为辅助技术设计的
- 后台操作是核心功能，不是副作用

**原因 2：权限控制**
- 需要用户明确授权
- 系统有完整的安全机制
- 透明、可控

**原因 3：用户体验**
- 不打断用户工作流
- 类似"助手"的体验
- 这是 AI agent 应有的表现

**原因 4：业界实践**
- VoiceOver（macOS 屏幕阅读器）后台运行
- Voice Control（语音控制）后台操作
- Codex 使用相同的技术栈

### ⚠️ 需要注意的

**权限要求**：
- 必须有 Accessibility 权限
- 必须有 Screen Recording 权限
- 用户需要明确授权

**应用兼容性**：
- 并非所有应用 AX 支持都完善
- 某些应用可能需要前台才能操作
- Codex 也会遇到这种情况（对话中多次重试）

**操作可见性**：
- 后台操作用户看不到
- 需要通过 UI 反馈让用户知道在做什么
- Codex 通过对话描述 + 可能的视觉效果

---

## 实现建议

### 对于我们的项目

#### 1. 支持后台操作（推荐）
```swift
// Swift helper 添加
func click(elementIndex: String) -> ActionResult {
    guard let element = findElement(by: elementIndex) else {
        return .failed("Element not found")
    }
    
    // 尝试 AX action（后台）
    let result = AXUIElementPerformAction(element, kAXPressAction)
    if result == .success {
        return .success
    }
    
    // 降级到坐标点击（需要前台）
    activateApp()
    clickAtCoordinate(...)
}
```

#### 2. LSUIElement 配置（可选）
```xml
<!-- Info.plist -->
<key>LSUIElement</key>
<true/>
```

**好处**：
- 不出现在 Dock
- 不影响用户的应用切换
- 更像"后台助手"

**缺点**：
- 没有窗口图标
- 调试时不太方便

#### 3. 透明度给用户
```typescript
// 在 CLI 输出中告知用户
console.log("Operating QQ Music in background...")
console.log("Your current work won't be interrupted")
```

---

## 结论

### Codex 的后台操作：

**技术实现**：
- ✅ LSUIElement = true（不显示在 Dock）
- ✅ Accessibility API 后台操作能力
- ✅ 优先使用 AX actions（后台）
- ✅ 必要时激活应用（坐标点击）

**合理性**：
- ✅ 完全合理
- ✅ macOS 的设计初衷
- ✅ 需要用户授权
- ✅ 提升用户体验

**虚拟光标**：
- 可能是 Codex UI 的浮动窗口
- 或者只是在 Codex 界面显示
- 纯视觉反馈，实际操作是后台 AX action

### 我们可以学习：

1. ✅ 优先使用 AX actions（后台）
2. ✅ 支持 element_index 定位
3. ✅ 必要时才激活应用
4. ⚠️ LSUIElement 可选（看产品定位）

**这不是 hack，是 macOS 的正确用法！**
