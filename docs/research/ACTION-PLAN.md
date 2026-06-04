# 深入研究 macOS Accessibility API - 行动计划

## 第一阶段：观察 Codex 的实际行为

### 1.1 使用 Accessibility Inspector 观察 Codex

```bash
# 打开 Xcode 的 Accessibility Inspector
open /Applications/Xcode.app/Contents/Applications/Accessibility\ Inspector.app

# 或者从 Xcode 菜单
# Xcode -> Open Developer Tool -> Accessibility Inspector
```

**观察任务**：
1. 让 Codex 操作一个应用（如你截图中的 QQ Music）
2. 在 Accessibility Inspector 中查看：
   - Codex 读取了哪些 AX 属性？
   - AX tree 的完整层级结构
   - 每个元素暴露了哪些 actions
   - 哪些元素有丰富的 AX 信息，哪些没有

**截图/记录**：
- QQ Music 的完整 AX tree 结构
- 搜索框的所有可用属性
- 搜索结果列表的结构

### 1.2 查看 Codex 进程和通信

```bash
# 查找 Codex 相关进程
ps aux | grep -i codex

# 查看 Codex 的文件结构
ls -la /Applications/Codex.app/Contents/
ls -la /Applications/Codex.app/Contents/MacOS/
ls -la /Applications/Codex.app/Contents/Frameworks/

# 查看是否有 helper daemon
sudo launchctl list | grep -i codex

# 查看 Codex 的网络连接
lsof -i -P | grep -i codex

# 查看 Codex 打开的文件
lsof -p $(pgrep -i codex | head -1) | head -50
```

**分析目标**：
- 是否有独立的 daemon 进程？
- 进程之间如何通信？
- 是否使用 Screenshot API？
- 网络流量大小（判断是否发送截图）

---

## 第二阶段：AX API 完整能力清单

### 2.1 标准 AX 属性（100+ 个）

#### 基础属性
```swift
// 识别
kAXRoleAttribute              // 元素类型："AXButton", "AXTextField"
kAXRoleDescriptionAttribute   // 角色描述
kAXSubroleAttribute           // 子角色
kAXTitleAttribute             // 标题文本
kAXDescriptionAttribute       // 描述

// 值和状态
kAXValueAttribute             // 当前值（文本、数字、选中状态）
kAXValueDescriptionAttribute  // 值的描述
kAXMinValueAttribute          // 最小值（slider, progress）
kAXMaxValueAttribute          // 最大值
kAXEnabledAttribute           // 是否可用
kAXFocusedAttribute           // 是否获得焦点
kAXSelectedAttribute          // 是否被选中

// 位置和尺寸
kAXPositionAttribute          // (x, y) 屏幕坐标
kAXSizeAttribute              // (width, height)
kAXFrameAttribute             // 完整的 CGRect

// 层级关系
kAXParentAttribute            // 父元素
kAXChildrenAttribute          // 子元素数组
kAXSelectedChildrenAttribute  // 选中的子元素
kAXVisibleChildrenAttribute   // 可见的子元素
kAXWindowAttribute            // 所属窗口
kAXTopLevelUIElementAttribute // 顶层元素
```

#### 文本相关
```swift
kAXNumberOfCharactersAttribute   // 字符数
kAXSelectedTextAttribute         // 选中的文本
kAXSelectedTextRangeAttribute    // 选中的范围
kAXInsertionPointLineNumberAttribute
kAXPlaceholderValueAttribute     // 占位符文本
```

#### 表格/列表
```swift
kAXRowsAttribute                 // 行
kAXColumnsAttribute              // 列
kAXSelectedRowsAttribute         // 选中的行
kAXVisibleRowsAttribute          // 可见的行
kAXRowIndexRangeAttribute        // 行索引范围
```

#### 窗口
```swift
kAXMainAttribute                 // 是否主窗口
kAXMinimizedAttribute            // 是否最小化
kAXFullScreenAttribute           // 是否全屏
kAXModalAttribute                // 是否模态
```

#### 菜单
```swift
kAXMenuItemCmdCharAttribute      // 快捷键字符
kAXMenuItemCmdModifiersAttribute // 快捷键修饰符
kAXMenuItemMarkCharAttribute     // 标记字符
```

### 2.2 标准 AX Actions

```swift
kAXPressAction           // 按下（按钮）
kAXIncrementAction       // 增加（stepper, slider）
kAXDecrementAction       // 减少
kAXConfirmAction         // 确认
kAXCancelAction          // 取消
kAXPickAction            // 选择（颜色选择器）
kAXRaiseAction           // 提升窗口
kAXShowMenuAction        // 显示菜单
kAXDeleteAction          // 删除
```

### 2.3 标准 AX Roles（50+ 个）

```
常见角色：
- AXApplication
- AXWindow
- AXButton
- AXTextField
- AXTextArea
- AXStaticText
- AXImage
- AXMenu
- AXMenuItem
- AXMenuBar
- AXPopUpButton
- AXCheckBox
- AXRadioButton
- AXSlider
- AXScrollBar
- AXScrollArea
- AXTable
- AXRow
- AXCell
- AXOutline
- AXGroup
- AXLink
- AXList
- AXToolbar
- AXSplitter
- AXProgressIndicator
- AXBrowser
- AXComboBox
- AXTabGroup
- AXSheet
- AXDrawer
```

---

## 第三阶段：实战分析

### 3.1 对比测试

**目标**：对比我们当前的实现和 Codex 的行为

1. **相同任务，不同方法**：
   ```
   任务：QQ Music 搜索"周杰伦"
   
   Codex 方法：
   - [ ] 记录 Codex 执行步骤
   - [ ] 截图每个中间状态
   - [ ] 分析它如何定位元素
   
   我们的方法：
   - [ ] 运行 UC-102
   - [ ] 对比差异
   ```

2. **AX 信息提取对比**：
   ```bash
   # 我们当前提取的信息
   ./dist/cli/index.js usecases run UC-102 --mac-helper ./native/mac-helper/.build/debug/computer-use-mac-helper | jq '.data.trace[] | select(.kind == "observation") | .observation.elements[0]'
   
   # 看看我们遗漏了哪些有用的 AX 属性
   ```

### 3.2 使用 Xcode 工具实战

**任务 1：查看完整的 AX tree**

```bash
# 在 Accessibility Inspector 中
1. 启动 QQ Music
2. 打开搜索页面
3. 在 Inspector 中选择 QQ Music 进程
4. 查看完整的层级结构
5. 记录每个关键元素的所有属性
```

**任务 2：测试 AX Actions**

在 Accessibility Inspector 中：
1. 选择一个按钮
2. 查看 "Actions" 面板
3. 点击 "Press" 看是否能触发
4. 测试不同元素支持哪些 actions

**任务 3：对比 App 的 AX 支持质量**

测试几个应用：
- ✅ Safari（Apple 原生，AX 支持极好）
- ⚠️ QQ Music（第三方，AX 支持参差不齐）
- ❌ Electron 应用（通常 AX 支持较差）

记录：哪些 App 适合纯 AX 方案，哪些需要 Vision 辅助。

---

## 第四阶段：提取完整 AX 信息

### 4.1 增强我们的 Swift helper

**当前问题**：我们只提取了 `role`, `name`, `frame`

**改进目标**：提取所有有用的属性

```swift
// 当前实现（简化版）
func extractElement(_ element: AXUIElement) -> [String: Any] {
    return [
        "role": getAttribute(element, kAXRoleAttribute),
        "name": getAttribute(element, kAXTitleAttribute),
        "frame": getAttribute(element, kAXFrameAttribute)
    ]
}

// 增强版（提取完整信息）
func extractElementComplete(_ element: AXUIElement) -> [String: Any] {
    var result: [String: Any] = [:]
    
    // 基础
    result["role"] = getAttribute(element, kAXRoleAttribute)
    result["roleDescription"] = getAttribute(element, kAXRoleDescriptionAttribute)
    result["title"] = getAttribute(element, kAXTitleAttribute)
    result["description"] = getAttribute(element, kAXDescriptionAttribute)
    
    // 值和状态
    result["value"] = getAttribute(element, kAXValueAttribute)
    result["enabled"] = getAttribute(element, kAXEnabledAttribute)
    result["focused"] = getAttribute(element, kAXFocusedAttribute)
    result["selected"] = getAttribute(element, kAXSelectedAttribute)
    
    // 位置
    result["position"] = getAttribute(element, kAXPositionAttribute)
    result["size"] = getAttribute(element, kAXSizeAttribute)
    
    // 层级
    result["parentRole"] = getParentRole(element)
    result["childrenCount"] = getChildrenCount(element)
    
    // Actions
    result["actions"] = getAvailableActions(element)
    
    // 特殊属性（根据 role）
    if isTextField(element) {
        result["placeholder"] = getAttribute(element, kAXPlaceholderValueAttribute)
        result["numberOfCharacters"] = getAttribute(element, kAXNumberOfCharactersAttribute)
    }
    
    return result
}
```

### 4.2 结构化 AX Tree

**当前问题**：我们返回扁平的元素列表

**改进目标**：返回层级树结构

```typescript
interface AXElement {
  id: string
  role: string
  title?: string
  value?: any
  frame: { x: number, y: number, width: number, height: number }
  enabled: boolean
  focused: boolean
  actions: string[]
  children?: AXElement[]  // 子元素（层级结构）
  path: string            // 从根到此元素的路径
}
```

**好处**：
- Claude 可以理解上下文（"搜索框在导航栏内"）
- 可以用路径定位元素（`/window/toolbar/searchfield`）
- 更接近 HTML DOM 的结构

---

## 第五阶段：纯 AX 方案 vs 混合方案

### 5.1 纯 AX 方案（理想情况）

**假设**：App 的 AX 支持完美

```typescript
// 完全不需要截图
const observation = await helper.getAppState(target)
// observation.axTree 包含完整的结构化信息

const response = await anthropic.messages.create({
  model: "claude-opus-4-8",
  messages: [{
    role: "user",
    content: `
      Here is the accessibility tree of QQ Music app:
      ${JSON.stringify(observation.axTree, null, 2)}
      
      Please find the search input and type "周杰伦"
    `
  }]
})
```

**优点**：
- 快（无需截图和 Vision）
- 准确（语义化信息）
- 成本低（文本 token << 图像 token）

**缺点**：
- 依赖 App 的 AX 实现质量
- 无法处理纯视觉元素（图标、颜色）

### 5.2 混合方案（现实方案）

**策略**：优先 AX，必要时用 Vision

```typescript
class HybridCapability {
  async execute(action, observation) {
    // 1. 尝试 AX 方案
    const axResult = await this.tryAXMethod(action, observation.axTree)
    if (axResult.success) {
      return axResult
    }
    
    // 2. AX 失败，降级到 Vision
    const screenshot = await helper.screenshot(target)
    const visionResult = await this.tryVisionMethod(action, screenshot)
    return visionResult
  }
}
```

**决策规则**：
```typescript
function shouldUseVision(action, observation) {
  // 元素找不到
  if (!findElement(observation.axTree, action.target)) {
    return true
  }
  
  // 元素没有有效的 name
  const element = findElement(observation.axTree, action.target)
  if (!element.title && !element.value) {
    return true
  }
  
  // 需要视觉判断（颜色、图标）
  if (action.requiresVisual) {
    return true
  }
  
  return false
}
```

---

## 立即行动

### 今天晚上可以完成的任务

**任务 1**：用 Accessibility Inspector 观察 Codex（30 分钟）
```bash
1. 打开 Accessibility Inspector
2. 让 Codex 搜索 QQ Music
3. 观察并截图 AX tree 结构
4. 记录 Codex 操作的元素属性
```

**任务 2**：查看 Codex 进程信息（15 分钟）
```bash
# 运行上面的命令
ps aux | grep -i codex
lsof -i -P | grep -i codex
# 截图结果
```

**任务 3**：增强我们的 Swift helper（2 小时）
- 提取更多 AX 属性
- 返回层级树结构
- 提取 available actions

---

## 你现在可以帮我做的

1. **运行 Accessibility Inspector**
   ```bash
   open /Applications/Xcode.app/Contents/Applications/Accessibility\ Inspector.app
   ```
   - 观察 Codex 操作 QQ Music
   - 截图关键界面的 AX tree
   - 发给我分析

2. **查看 Codex 进程**
   ```bash
   ps aux | grep -i codex
   ls -la /Applications/Codex.app/Contents/MacOS/
   ```
   - 截图结果
   - 看看有哪些进程和文件

3. **提供 QQ Music 的完整 AX tree**
   - 用 Inspector 导出完整的树结构
   - 或者截图层级视图

**现在开始执行哪个？**
