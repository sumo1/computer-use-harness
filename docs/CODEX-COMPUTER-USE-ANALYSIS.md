# Codex Computer Use 技术架构分析

基于对 SkyComputerUseClient 二进制的逆向分析和 MCP 配置的发现。

## 核心架构

### MCP (Model Context Protocol) 集成

Codex 使用 **Model Context Protocol** 来实现 Computer Use：

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "./SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
      "args": ["mcp"],
      "cwd": "."
    }
  }
}
```

**架构**：
```
Codex App (Electron)
    ↓
MCP Protocol (stdio)
    ↓
SkyComputerUseClient (Swift, arm64)
    ↓
macOS Frameworks:
  - ApplicationServices (Accessibility)
  - CoreGraphics (Screenshot)
  - Carbon (Keyboard)
  - AppKit (UI)
```

---

## 工具定义（从二进制提取）

### 1. `get_app_state`

**描述**：
> "Start an app use session if needed, then get the state of the app's key window and return a screenshot and accessibility tree. This must be called once per assistant turn before interacting with the app"

**返回**：
- Screenshot（PNG/JPEG）
- Accessibility Tree（结构化数据）

**关键点**：
- ✅ **每轮必须先调用** `get_app_state`
- ✅ **同时返回** Screenshot + AX tree
- ✅ 这是 Codex 的核心：**混合方案**

### 2. `click`

**描述**：
> "Click an element by index or pixel coordinates from screenshot"

**参数**：
- `element_index`: 元素索引（来自 AX tree）
- `x`, `y`: 截图像素坐标
- `clicks`: 点击次数（默认 1）
- `button`: 鼠标按钮（left/right/middle）

**关键点**：
- ✅ 支持两种定位方式：**AX index** 或 **坐标**
- ✅ Claude 可以选择用哪种方式

### 3. `scroll`

**描述**：
> "Number of pages to scroll. Fractional values are supported. Defaults to 1"

**参数**：
- `pages`: 滚动页数（支持小数）
- `direction`: 方向（up/down）

**关键点**：
- ✅ 这就是 Codex 能滚动查看更多内容的原因！

### 4. `type_text` / `type`

**描述**：
> "Type literal text using keyboard input"

**支持**：
- xdotool 的 `key` 语法
- 支持修饰键组合
- 布局无关（使用 Unicode 事件）

### 5. `perform_secondary_action`

**描述**：
> "Invoke a secondary accessibility action exposed by an element"

**参数**：
- `action_name`: AX action 名称（如 `AXPress`, `AXShowMenu`）
- `element_index`: 目标元素索引

**关键点**：
- ✅ 直接调用 AX actions
- ✅ 不依赖坐标或视觉

### 6. `set_value`

**描述**：
> "Set the value of a settable accessibility element"

**用途**：
- 设置文本框内容
- 设置 slider 值
- 设置 checkbox 状态

### 7. `select_text`

**描述**：
> "Select text inside a text element, or place the text cursor before or after it. Provide text exactly as it appears in the accessibility tree"

**参数**：
- `text`: 目标文本（来自 AX tree）
- `prefix`, `suffix`: 消歧义用的上下文

---

## 混合方案的工作流程

### 典型操作流程

```
1. Claude: call get_app_state()
   → 返回: {screenshot: "base64...", ax_tree: [...]}

2. Claude 分析:
   - 看到截图中的视觉布局
   - 读取 AX tree 的结构化信息
   - 决定如何操作

3a. 如果 AX tree 有丰富信息:
   Claude: call click(element_index=5)
   → 精确点击 AX 元素

3b. 如果 AX tree 信息不足:
   Claude: call click(x=320, y=180)
   → 基于截图坐标点击

4. Claude: call get_app_state()
   → 获取新状态，继续下一步
```

### 为什么这个方案优秀

**优点**：
1. ✅ **最大化利用 AX**：优先使用结构化信息
2. ✅ **降级到 Vision**：AX 不足时用坐标
3. ✅ **自适应**：Claude 自己决定用哪种方式
4. ✅ **覆盖所有场景**：AX 好的 App 快速准确，AX 差的 App 也能工作

**对比纯 AX 方案**：
- 纯 AX：QQ Music 这种 AX 支持差的 App 会失败
- 混合：Claude 看到截图，即使 AX 不好也能找到元素

**对比纯 Vision 方案**：
- 纯 Vision：慢、贵、不准确
- 混合：优先用 AX（快速准确），必要时才用坐标

---

## 技术实现细节

### 依赖的 macOS Frameworks

从 `otool -L` 的输出：

```
关键框架：
- ApplicationServices       // AX API
- CoreGraphics             // 截图和绘图
- Carbon                   // 键盘事件
- AppKit                   // UI 操作
- WebKit                   // 可能用于渲染或 Web 内容
- Swift runtime            // 用 Swift 编写
```

### 实现语言

- **Swift**（arm64 原生）
- 使用 Swift 的现代异步特性
- 集成 MCP 协议（stdio 通信）

### 权限要求

从字符串中看到：
```
"Computer Use permissions are still pending. The user has not finished granting Accessibility and Screen Recording permissions"
```

需要两个权限：
1. **Accessibility** - 读取 AX tree + 模拟点击/输入
2. **Screen Recording** - 截图

---

## 与 Anthropic Computer Use 的对比

| 维度 | Anthropic | Codex |
|------|-----------|-------|
| **协议** | 直接 Tool Call | MCP Server |
| **数据源** | Screenshot only | Screenshot + AX tree |
| **定位方式** | 坐标 only | AX index OR 坐标 |
| **滚动** | `scroll` action | `scroll` tool (支持小数) |
| **鼠标移动** | `mouse_move` | 无独立 move（点击时移动） |
| **文本选择** | 无 | `select_text` tool |
| **AX Actions** | 无 | `perform_secondary_action` |
| **实现语言** | Python | Swift |
| **架构** | Agent Loop | MCP Plugin |

---

## 关键洞察

### 1. **必须先调用 `get_app_state`**

```
"You first must call `get_app_state` to get the latest state before doing other Computer Use actions."
```

这是**强制规则**：
- 每轮操作前必须获取最新状态
- 返回 Screenshot + AX tree
- Claude 基于两者决策

### 2. **Claude 自主选择定位方式**

Codex 给 Claude 提供了**两种选择**：
- `click(element_index=...)` - 用 AX
- `click(x=..., y=...)` - 用坐标

Claude 自己判断用哪种更合适。

### 3. **AX tree 的文本要精确匹配**

```
"Provide text exactly as it appears in the accessibility tree, including any Markdown formatting."
```

这说明 Codex 的 AX tree 可能包含格式化信息。

### 4. **支持高级 AX 操作**

`perform_secondary_action` 允许直接调用任何 AX action：
- 不只是 click
- 可以调用 `AXShowMenu`, `AXIncrement` 等

---

## 我们可以学习的点

### 立即可以做的

1. **实现混合方案**
   ```typescript
   interface Observation {
     screenshot: string      // base64 PNG
     axTree: AXElement[]    // 结构化 AX tree
   }
   
   // Claude 可以选择：
   action.element_index = 5  // 用 AX
   // 或
   action.x = 320, action.y = 180  // 用坐标
   ```

2. **添加 Scroll**
   ```typescript
   scroll(pages: number, direction: "up" | "down")
   // 支持小数页数
   ```

3. **增强 AX 信息提取**
   - 返回完整的 AX tree（不只是扁平列表）
   - 包含所有可用的 attributes
   - 包含所有可用的 actions

4. **强制每轮先获取状态**
   ```typescript
   // 每轮开始
   const state = await getAppState(target)
   // 同时返回 screenshot + axTree
   ```

### 需要架构调整的

5. **考虑 MCP 集成**
   - 我们已经有 MCP 工具了（context7, grafana）
   - 可以将 Computer Use 也做成 MCP server
   - 好处：标准化、可插拔

6. **让 Claude 选择定位方式**
   - 不是我们决定用 AX 还是坐标
   - 而是给 Claude 两种选项，让它选

---

## 下一步行动

### 立即验证

1. **用 Accessibility Inspector 观察 Codex**
   - 看它读取哪些 AX 属性
   - 看它返回的 AX tree 结构

2. **网络流量分析**
   ```bash
   # 监控 Codex 的网络流量
   sudo tcpdump -i any -n host api.openai.com -w codex-traffic.pcap
   
   # 让 Codex 执行一个操作
   # 然后分析抓包
   
   # 看发送的数据大小（判断是否包含截图）
   ```

3. **测试不同 App**
   - AX 好的 App（Safari）→ 看 Codex 是否用 element_index
   - AX 差的 App（QQ Music）→ 看 Codex 是否用坐标

### 实现计划

基于这些发现，我会更新实现计划：

1. **Phase 1**：混合方案基础（1-2 天）
   - 同时返回 screenshot + full AX tree
   - 支持两种定位方式

2. **Phase 2**：缺失能力（1 天）
   - Scroll
   - perform_secondary_action
   - select_text

3. **Phase 3**：MCP 集成（可选，1-2 天）
   - 将 Computer Use 做成 MCP server
   - 对齐 Codex 的接口

---

**现在你想让我：**
1. 继续用 Accessibility Inspector 观察 Codex？
2. 开始实现混合方案？
3. 先做网络抓包分析 Codex 的实际数据？
