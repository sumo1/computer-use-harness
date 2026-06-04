# Anthropic Computer Use vs Our Implementation - 核心差异分析

基于对 Anthropic 官方 `computer-use-best-practices` 实现的研究。

## Anthropic Computer Use 核心架构

### 1. Tool Definition（工具定义）

**单一统一工具**: `computer` tool

**支持的 Actions（3个版本演进）**:

#### v1: computer_20241022
- `screenshot` - 截图
- `mouse_move` - 移动鼠标
- `left_click` / `right_click` / `middle_click` / `double_click`
- `left_click_drag` - 拖拽
- `type` - 逐字符输入
- `key` - 按键
- `cursor_position` - 获取光标位置

#### v2: computer_20250124（增强版）
- 新增 `left_mouse_down` / `left_mouse_up` - 按住/释放
- 新增 `scroll` - 滚动
- 新增 `hold_key` - 按住按键
- 新增 `wait` - 等待
- 新增 `triple_click`

#### v3: computer_20251124（最新）
- 新增 `zoom_in` / `zoom_out` - 区域缩放

### 2. 技术实现（Python + PyAutoGUI）

**核心库**:
```python
import pyautogui          # 跨平台 GUI 自动化
from Quartz import *      # macOS 原生键盘事件
import subprocess         # 剪贴板访问
```

**关键实现**:

#### Screenshot（截图）
```python
def take_screenshot():
    img = pyautogui.screenshot()  # 捕获屏幕
    
    # Retina 处理：物理像素 → 逻辑像素
    if img.width != screen_w:
        img = img.resize((screen_w, screen_h))
    
    # 压缩到 API 限制内
    b64, (sent_w, sent_h) = resize_and_encode(img)
    return ToolResult(base64_image=b64)
```

**图像压缩策略**:
- 长边上限 1568px
- 总像素预算 1568 tiles
- JPEG 编码，可配置质量
- Base64 编码发送

#### Mouse Control（鼠标控制）
```python
# 点击
pyautogui.click(x, y, clicks=1, button="left")

# 移动
pyautogui.moveTo(x, y)

# 拖拽
pyautogui.dragTo(x, y, duration=0.3)

# 滚动
pyautogui.scroll(amount)  # 正数向上，负数向下
```

#### Coordinate Scaling（坐标缩放）
```python
def _scale_to_screen(coord):
    x, y = coord
    # 从 API 返回的坐标 → 实际屏幕坐标
    sx = round(x * screen_w / sent_w)
    sy = round(y * screen_h / sent_h)
    return (sx, sy)
```

**关键设计**：
1. 截图可能被压缩（如 2560x1440 → 1024x768）
2. Claude 看到的是压缩后的图像
3. Claude 返回的坐标是基于压缩图像的
4. 工具需要将坐标缩放回真实屏幕分辨率

#### Keyboard Input（键盘输入）

**布局无关输入**（使用 macOS Quartz API）:
```python
def _type_text(text: str):
    for ch in text:
        # 使用 Unicode 事件，不依赖键盘布局
        ev = CGEventCreateKeyboardEvent(None, 0, True)
        CGEventKeyboardSetUnicodeString(ev, len(ch), ch)
        CGEventPost(kCGHIDEventTap, ev)
```

这解决了 PyAutoGUI 硬编码 QWERTY 的问题。

### 3. Agent Loop（执行循环）

```python
while True:
    # 1. 截图并压缩
    screenshot = computer.take_screenshot()
    
    # 2. 调用 Claude API（流式）
    with api.stream(
        model="claude-3-5-sonnet",
        messages=[...],
        tools=[computer_tool],
        system=[...],
    ) as stream:
        # 处理流式响应
    
    # 3. 提取 tool_use 块
    for tool_use in response.content:
        if tool_use.type == "tool_use":
            # 执行工具
            result = tools.run(tool_use.name, tool_use.input)
            
            # 添加结果到消息历史
            messages.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": result
                }]
            })
    
    # 4. 图像修剪（避免 context 爆炸）
    prune_old_images(messages)
    
    # 5. 继续下一轮
```

**Context 管理**:
- **Prompt caching**: 系统提示和最近 3 个块
- **Image pruning**: 只保留最近 N 张截图
- **Auto-compaction**: 超过阈值时自动压缩上下文

---

## 我们的实现 vs Anthropic

### 架构对比

| 维度 | Anthropic Computer Use | Our Implementation |
|------|------------------------|-------------------|
| **工具模型** | 单一 `computer` tool | 8 个独立 Capabilities |
| **执行方式** | Claude API 直接调用工具 | 我们的 runner 调用 capabilities |
| **坐标系统** | 压缩图像坐标 + 缩放 | 原始屏幕坐标（无压缩） |
| **截图处理** | 每轮自动截图并压缩 | 按需截图，未压缩 |
| **鼠标控制** | PyAutoGUI 直接控制 | Swift helper → AX API |
| **Agent Loop** | Python 流式循环 | TypeScript UseCase Runner |

### 核心差异分析

#### 1. **缺少鼠标移动可视化**

**Anthropic**:
```python
# 每次移动鼠标都是真实的系统鼠标
pyautogui.moveTo(x, y)  # 用户能看到光标移动
```

**我们**:
```typescript
// 我们没有 mouse_move，只有点击
await helper.click({ x, y })  // 没有可视化光标
```

**解决方案**: 添加虚拟光标 overlay（macOS Quartz 绘制）。

---

#### 2. **缺少滚动能力**

**Anthropic**:
```python
pyautogui.scroll(10)  # 向上滚动 10 个单位
```

**我们**:
```typescript
// 我们的 scroll 从未真正实现
await helper.scroll({ direction: "down", amount: 1 })
```

**解决方案**: Swift helper 使用 `CGEventCreateScrollWheelEvent`。

---

#### 3. **坐标缩放策略不同**

**Anthropic**:
- 截图压缩到 1568px 内
- Claude 看到压缩图
- 返回坐标基于压缩图
- 工具缩放回屏幕坐标

**我们**:
- 截图不压缩（PNG base64）
- Claude 看到原始尺寸
- 坐标直接是屏幕坐标
- 无需缩放

**优劣**:
- Anthropic: API 调用更快（图像更小），但需要坐标转换
- 我们: 更直观（无坐标转换），但 API 调用更慢

---

#### 4. **多轮探索策略**

**Anthropic**:
```
Loop iteration 1: screenshot → click album tab
Loop iteration 2: screenshot → scroll down
Loop iteration 3: screenshot → click album detail
Loop iteration 4: screenshot → extract info
```

每次 Claude 看到新截图，决定下一步。

**我们**:
```
Step 1: open app
Step 2: type search
Step 3: press Enter
Step 4: extract (只有一次截图)
```

UseCase 是预定义步骤，不支持"看结果再决定"的循环。

**解决方案**: 
- 方案 A: 改为 Agent Loop（像 Anthropic 一样）
- 方案 B: UseCase 支持条件和循环

---

#### 5. **Context 管理**

**Anthropic**:
- 自动修剪旧截图
- Prompt caching
- Auto-compaction

**我们**:
- 不保留历史截图
- 每个 step 独立

**差异**: Anthropic 是持续对话，我们是单次执行。

---

## 关键缺失能力

### P0 - 立即需要

1. **Scroll（滚动）**
   - Anthropic: `pyautogui.scroll(amount)`
   - 我们: 未实现
   - 影响: 无法查看屏幕外内容

2. **Mouse Move（鼠标移动）**
   - Anthropic: `pyautogui.moveTo(x, y)`
   - 我们: 只有点击，无移动
   - 影响: 无法 hover、无可视化

3. **Multi-round Loop（多轮循环）**
   - Anthropic: 每次截图 → 决策 → 执行 → 截图
   - 我们: 固定步骤序列
   - 影响: 无法动态探索

### P1 - 体验优化

4. **Drag（拖拽）**
   - Anthropic: `pyautogui.dragTo(x, y)`
   - 我们: 未实现

5. **Mouse Down/Up（按住/释放）**
   - Anthropic: 独立的 down/up 操作
   - 我们: 未实现

6. **Wait（等待）**
   - Anthropic: `wait(duration)` 作为 action
   - 我们: WaitForState 基于条件

---

## 推荐架构调整

### 选项 A: 全面对齐 Anthropic（大重构）

**改为 Agent Loop 模式**:

```typescript
while (!done) {
  // 1. 截图
  const screenshot = await helper.screenshot(target)
  
  // 2. 调用 Claude API
  const response = await anthropic.messages.create({
    model: "claude-opus-4-8",
    messages: conversationHistory,
    tools: [computerTool],  // 单一工具
    max_tokens: 4096,
  })
  
  // 3. 执行工具调用
  for (const toolUse of response.content) {
    if (toolUse.type === "tool_use") {
      const result = await executeComputerTool(toolUse.input)
      conversationHistory.push({
        role: "user",
        content: [{ type: "tool_result", ...result }]
      })
    }
  }
}
```

**优点**: 
- 完全对齐 Anthropic 设计
- 支持动态探索
- Claude 自主决策每一步

**缺点**:
- 推翻现有 Capability 架构
- 失去 UseCase 的确定性
- 成本更高（每步都调 API）

---

### 选项 B: 混合模式（推荐）

**保留 Capability 架构，增强关键能力**:

1. **添加缺失的 Actions**:
   ```typescript
   - ScrollCapability
   - MouseMoveCapability
   - DragCapability
   ```

2. **UseCase 支持"Claude 决策"步骤**:
   ```yaml
   - type 周杰伦 into search
   - press Enter
   - wait for results
   - let Claude explore and extract album info  # 新：Agent 模式
   ```

3. **Agent 模式作为特殊 Capability**:
   ```typescript
   class AgentExplorerCapability {
     async execute(action) {
       // 进入 Agent Loop 直到完成目标
       while (!goalAchieved) {
         const screenshot = await takeScreenshot()
         const decision = await callClaudeAPI(screenshot, goal)
         await executeDecision(decision)
       }
     }
   }
   ```

**优点**:
- 保留现有架构
- UseCase 仍然可预测
- 关键步骤可以用 Agent 模式
- 渐进式改进

---

## 立即行动项

### 今天可以做（2-3h）

1. **添加 Scroll**
   ```swift
   func scroll(direction: String, amount: Int)
   ```

2. **添加 Mouse Move**
   ```swift
   func moveMouse(x: CGFloat, y: CGFloat)
   ```

3. **改进 UC-102**
   ```yaml
   - scroll down
   - scroll down
   - extract visible albums
   ```

### 本周可以做（1-2 天）

4. **Agent Explorer Capability**
   - 实现 mini Agent Loop
   - 用于"探索并提取"类任务

5. **虚拟光标**
   - Quartz overlay
   - 用户看到操作过程

---

## 总结

**核心发现**:
1. Anthropic 用 **单一 computer tool + Agent Loop**
2. 我们用 **多 Capability + 固定 UseCase**
3. 关键缺失：**Scroll, Mouse Move, 多轮探索**

**最小改动方案**:
- 添加 Scroll (2h)
- 添加 Mouse Move (1h)
- UC-102 改用滚动 + 多次截图 (1h)
- **4 小时即可解决"周杰伦最新专辑"问题**

**长期方向**:
- 混合模式：UseCase + Agent Explorer
- 保留 Capability 架构优势
- 关键步骤用 Agent Loop
