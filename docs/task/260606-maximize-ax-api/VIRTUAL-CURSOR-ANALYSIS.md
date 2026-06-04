# Codex 虚拟光标分析

## 结论：没有独立的虚拟光标功能

### 证据

#### 1. 工具列表中没有 mouse_move
```
10个工具：
- list_apps
- get_app_state
- click
- perform_secondary_action
- set_value
- select_text
- scroll
- drag
- press_key
- type_text

❌ 没有 mouse_move 工具
❌ 没有 cursor 相关工具
```

#### 2. click 工具的描述
```
"Click an element by index or pixel coordinates from screenshot"
```
- 只有 click，没有 move
- 直接点击目标位置

#### 3. 二进制分析
```
找到的 cursor 相关字符串：
- "cursor_before" / "cursor_after" - 这是 select_text 工具的参数（文本光标位置）
- "Mouse button to click" - click 工具的参数
- CGEvent API - macOS 底层事件 API

❌ 没有找到 "mouse_move" 或 "moveTo"
```

---

## 虚拟光标是什么？

### 可能性 1：UI 渲染的视觉反馈（最可能）

你在截图中看到的"虚拟光标"可能是：
- **Codex UI 的可视化效果**
- 不是 SkyComputerUseClient 生成的
- 而是 Codex 主应用在**截图上叠加**的光标图标
- 用于给用户展示"Codex 要点哪里"

**类似于**：
```
用户界面显示：
[截图] + [光标图标 overlay at (x, y)]
```

这是**展示层**的功能，不是**执行层**的功能。

### 可能性 2：使用系统真实鼠标（部分可能）

Codex 使用 `CGEvent` API，这是 macOS 底层事件系统：
- `CGEventCreateMouseEvent` - 创建鼠标事件
- `CGEventPost` - 发送事件

**可能的实现**：
```swift
// 点击时可能包含移动
func click(x: CGFloat, y: CGFloat) {
    // 1. 创建鼠标移动事件
    let moveEvent = CGEventCreateMouseEvent(
        nil, 
        .mouseMoved, 
        CGPoint(x: x, y: y), 
        .left
    )
    CGEventPost(.cghidEventTap, moveEvent)
    
    // 2. 创建点击事件
    let clickEvent = CGEventCreateMouseEvent(
        nil, 
        .leftMouseDown, 
        CGPoint(x: x, y: y), 
        .left
    )
    CGEventPost(.cghidEventTap, clickEvent)
    // ...
}
```

**但是**：
- 这只是在点击前移动系统光标到目标位置
- 不是独立的"虚拟光标"功能
- 用户会看到真实的系统鼠标移动

### 可能性 3：不是光标，是高亮框

你看到的可能不是"光标"，而是：
- **元素高亮框**
- 当 Codex 要点击某个元素时
- UI 上画一个框标注"要点这里"

---

## 与 AX 能力的关系

### AX 本身没有光标能力

**macOS Accessibility API 提供**：
- ✅ 读取元素属性（role, name, value）
- ✅ 执行元素 actions（AXPress, AXShowMenu）
- ✅ 设置元素值（AXValue）
- ❌ **没有光标绘制能力**

**光标/鼠标操作需要**：
- CoreGraphics (`CGEvent` API)
- 或 AppKit (`NSEvent.mouseLocation`)

### Codex 的实现组合

```
1. AX API - 获取元素信息和位置
   ↓
2. 决定点击位置（element_index → 查 AX tree → 获取坐标）
   ↓
3. CGEvent API - 模拟鼠标点击
   ↓
4. (可选) 在 UI 上叠加光标图标给用户看
```

---

## 对比：Anthropic Computer Use

Anthropic 的实现（我们已分析过）：
```python
# 有独立的 mouse_move action
pyautogui.moveTo(x, y)  # 移动系统鼠标
pyautogui.click(x, y)   # 点击
```

**Anthropic 有 mouse_move**：
- ✅ 作为独立的 action
- ✅ 可以 hover（悬停）
- ✅ 用户看到真实鼠标移动

**Codex 没有 mouse_move**：
- ❌ 只有 click（可能内部包含移动）
- ❌ 不支持独立的 hover 操作
- ❓ 虚拟光标可能是 UI 叠加效果

---

## 总结

### 你在截图中看到的"虚拟光标"最可能是：

**UI 层的可视化反馈**
- Codex 主应用在截图上叠加光标图标
- 不是 SkyComputerUseClient 生成的
- 只是为了给用户展示"要点哪里"
- 类似于屏幕录制软件的光标高亮效果

### 不是 AX 的能力

AX 提供：
- ✅ 元素信息（位置、属性）
- ✅ 元素操作（点击、设置值）

光标需要：
- CoreGraphics (`CGEvent`)
- 或 UI 层的图形叠加

### 我们需要吗？

**如果是 UI 可视化**：
- 这是展示层的功能
- 对实际操作没有影响
- 可以在前端实现（如果有 UI）

**如果想要真实鼠标移动**：
- 可以添加 `mouse_move` capability
- 使用 `CGEvent` API
- 但 Codex 都没有这个功能
- 说明不是必需的

---

## 建议

1. **不需要实现虚拟光标**
   - Codex 都没有独立的 mouse_move
   - 直接点击就够了

2. **如果要增强可视化**
   - 在 UI 层（如果有）叠加光标图标
   - 或在截图上标注要点击的位置
   - 这是展示功能，不是核心能力

3. **专注核心差异**
   - Screenshot + 完整 AX tree
   - element_index 支持
   - Agent Loop
   - 这些才是关键
