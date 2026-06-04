# Computer Use 架构核心差异分析

## 问题重述

**不是**：为什么 QQ Music 找不到日期？
**而是**：为什么 Codex 的 Computer Use 比我们的实现更灵活、更智能？

---

## 核心架构差异对比

### 差异 1：数据源 - 单一 vs 混合

#### Codex 的方案
```
get_app_state() → {
  screenshot: base64_image,
  ax_tree: [完整的AX元素树]
}
```

**给 Claude 的信息**：
- ✅ 视觉信息（screenshot）
- ✅ 结构化信息（AX tree）
- ✅ Claude 同时看到两者，自主决策

#### 我们的方案
```typescript
// UC-102 step 5: read search results
observation = {
  elements: [扁平的AX元素列表]
}
```

**给 Claude 的信息**：
- ❌ 没有 screenshot
- ✅ 只有 AX tree
- ❌ Claude 只能基于不完整的 AX 信息决策

**差距根源**：
- 我们有 screenshot capability，但**没有返回给 Claude**
- 我们的 AX tree 是扁平列表，不是完整的树结构
- Claude 无法综合视觉和结构信息

---

### 差异 2：定位方式 - 单一 vs 双模式

#### Codex 的方案
```json
// Claude 可以自由选择
click({
  app: "QQMusic",
  element_index: "42"  // 选项1: AX索引（首选）
})

// 或者
click({
  app: "QQMusic", 
  x: 320,              // 选项2: 坐标（降级）
  y: 180
})
```

**灵活性**：
- ✅ AX 信息好 → 用 element_index（快速、准确、不依赖分辨率）
- ✅ AX 信息差 → 用坐标（降级但仍能工作）
- ✅ Claude 自主判断哪种更合适

#### 我们的方案
```typescript
// 我们的 Capability Chain
1. AXElementFinder → 失败
2. FirstResultClicker → 盲目点第一个
3. CoordinateClicker → 固定坐标

// Claude 看不到这个过程
// 我们的代码决定用哪个
```

**问题**：
- ❌ Claude 不参与决策
- ❌ 我们的代码硬编码降级逻辑
- ❌ 不够智能（FirstResultClicker 不管是什么都点）

**差距根源**：
- 我们没有给 Claude **选择权**
- 我们是"代替 Claude 思考"，而不是"给 Claude 工具让它思考"

---

### 差异 3：工作流程 - 固定步骤 vs 自适应循环

#### Codex 的方案
```python
# Agent Loop（Claude 主导）
while not done:
    # 1. Claude 看到当前状态
    state = get_app_state()  # screenshot + AX tree
    
    # 2. Claude 分析并决策
    # "搜索结果默认是'歌曲'，我需要切到'专辑'"
    
    # 3. Claude 选择操作和参数
    click(element_index="tab_albums")  # Claude 选的
    
    # 4. 获取新状态，继续
    state = get_app_state()
```

**特点**：
- ✅ Claude 每一步都看到完整信息
- ✅ Claude 根据实际情况调整策略
- ✅ 失败了可以重试（Codex 对话中多次重试）
- ✅ 动态探索（滚动查找更多结果）

#### 我们的方案
```yaml
# UC-102 固定步骤
steps:
  - open app
  - type 周杰伦 专辑
  - press Enter
  - wait for results
  - verify results page
  - extract album info  # 一次截图，没有循环
```

**问题**：
- ❌ 步骤是预定义的，不能根据实际情况调整
- ❌ 一次截图提取，不能"看到结果不对就滚动"
- ❌ 没有重试机制
- ❌ 不能动态探索

**差距根源**：
- 我们是 **UseCase-driven**（固定步骤）
- Codex 是 **Agent-driven**（Claude 自主循环）

---

### 差异 4：信息完整性 - 过滤 vs 完整

#### Codex 的方案
```typescript
// 推测：返回完整的 AX tree
{
  role: "AXGroup",
  name: "专辑项",
  value: null,
  selected: false,
  children: [
    {role: "AXStaticText", name: "太阳之子"},
    {role: "AXStaticText", name: "周杰伦"},
    {role: "AXStaticText", name: "2026-03-25"}  // 日期在子元素中
  ]
}
```

**信息密度**：
- ✅ 完整的层级树（children）
- ✅ 所有属性（value, selected, description）
- ✅ 不过滤小元素
- ✅ Claude 看到所有信息，自己判断什么重要

#### 我们的方案
```typescript
// 我们返回的
{
  role: "AXGroup",
  name: "专辑项",
  metadata: {
    frame: {...},
    enabled: true
  }
  // ❌ 没有 value
  // ❌ 没有 selected
  // ❌ 没有 children
  // ❌ 小元素被过滤（width < 50）
}
```

**问题**：
- ❌ 扁平列表，丢失层级关系
- ❌ 属性不全（缺 value, selected, description）
- ❌ 过滤掉了 64 个小元素（日期可能在其中）
- ❌ 我们决定什么"重要"，不是 Claude

**差距根源**：
- 我们在"帮 Claude 过滤信息"
- 应该给 Claude **完整信息**，让它自己判断

---

### 差异 5：接口设计 - Capability vs Tool

#### Codex 的方案
```typescript
// MCP Tools - Claude 直接调用
{
  name: "click",
  description: "Click an element by index or pixel coordinates",
  inputSchema: {
    element_index: "string",  // Claude 填这个
    x: "number",              // 或填这个
    y: "number"
  }
}
```

**Claude 的视角**：
- ✅ 我看到了 screenshot 和 AX tree
- ✅ 我知道"专辑"标签是 element_index="42"
- ✅ 我决定用 `click(element_index="42")`
- ✅ 我是主导者

#### 我们的方案
```typescript
// Capability Chain - 我们的代码决策
action = {
  kind: "click",
  target: {keyword: "专辑"}
}

// 然后我们的代码：
1. AXElementFinder.canHandle() → 试试找
2. 找不到 → FirstResultClicker.canHandle()
3. 盲目点第一个

// Claude 不知道发生了什么
```

**Claude 的视角**：
- ❌ 我说了"点击专辑"
- ❌ 但不知道你们怎么实现的
- ❌ 失败了也不知道为什么
- ❌ 我是被动的

**差距根源**：
- Codex: Claude 是 **决策者**，工具是执行者
- 我们: 我们的代码是决策者，Claude 是指挥者

---

## 核心问题：控制权在谁手里？

### Codex 的理念
```
Claude（大脑）
  ↓ 看到完整信息（screenshot + AX tree）
  ↓ 自主决策（用 index 还是坐标？）
  ↓ 直接调用工具（click, scroll, drag）
  ↓ 看到结果
  ↓ 根据结果调整策略
  ↓ 循环直到完成
```

**控制权**：完全在 Claude
**工具职责**：执行 Claude 的决策
**灵活性**：极高（Claude 可以应对任何情况）

### 我们的理念
```
Claude（指挥官）
  ↓ 给出高层指令（"搜索周杰伦"）
  ↓
我们的代码（参谋 + 执行者）
  ↓ 解析指令
  ↓ Capability Chain 决策如何执行
  ↓ 过滤信息
  ↓ 执行
  ↓ 返回简化的结果
  ↓
Claude（指挥官）
  ↓ 收到结果，继续下一步
```

**控制权**：在我们的代码
**工具职责**：决策 + 执行
**灵活性**：受限（我们代码的智能上限）

---

## 为什么 Codex 更智能？

### 原因 1：信息对称

**Codex**：Claude 看到的 = 工具看到的
- Screenshot + 完整 AX tree
- 所有元素、所有属性
- Claude 基于完整信息决策

**我们**：Claude 看到的 < 工具看到的
- 只有过滤后的 AX tree
- 部分元素、部分属性
- Claude 基于不完整信息决策

### 原因 2：决策主体

**Codex**：Claude 决策
- "我看到专辑标签 selected=false，我要点它"
- "我看到日期是 2026-03-25，这是最新的"
- "我要滚动看更多结果"

**我们**：代码决策
- FirstResultClicker: "我不管是什么，点第一个"
- 过滤逻辑: "width < 50 的元素不重要"
- 固定步骤: "不能滚动，只能执行预定义的步骤"

### 原因 3：闭环反馈

**Codex**：每步都有反馈循环
```
get_app_state → 分析 → 决策 → 执行 → get_app_state → ...
```
- 滚动后立即看到新内容
- 点击后立即确认是否到达正确页面
- 失败了立即重试

**我们**：开环执行
```
步骤1 → 步骤2 → 步骤3 → ... → 最后截图
```
- 中间步骤没有反馈
- 不知道是否成功
- 失败了不能调整

---

## 根本差异：架构哲学

### Codex 的哲学
**"给 Claude 完整的工具，让它自己思考"**

- 工具是简单的、直接的（click, scroll, type）
- Claude 组合这些工具完成复杂任务
- 灵活性来自 Claude 的智能，不是代码的智能

### 我们的哲学
**"给 Claude 智能的工具，替它思考"**

- 工具是复杂的、智能的（Capability Chain）
- 我们的代码尝试"理解"Claude 的意图
- 灵活性受限于我们代码的智能

---

## 对齐方向

### 方案 A：完全对齐 Codex（推荐）

**架构调整**：
```typescript
// 1. 返回完整信息
get_app_state() → {
  screenshot: base64,
  ax_tree: 完整的树（children, 所有属性）
}

// 2. 简化工具，给 Claude 控制权
tools = [
  click(element_index | x,y),
  scroll(direction, pages),
  type_text(text),
  press_key(key),
  drag(x1,y1,x2,y2)
]

// 3. Agent Loop
while not done:
  state = get_app_state()
  decision = claude.decide(state)
  result = execute(decision)
```

**收益**：
- ✅ 最大灵活性（Claude 的智能）
- ✅ 对齐业界最佳实践
- ✅ 适应任何 App

**成本**：
- 每步都调用 Claude API（贵）
- 需要重构现有架构

### 方案 B：混合模式（务实）

**保留 UseCase，增强关键能力**：
```yaml
# 大部分步骤：固定流程
- open app
- type search
- press Enter

# 关键步骤：Agent 模式
- let Claude explore and extract:
    # 进入 Agent Loop
    # Claude 自主滚动、点击、提取
    # 直到找到答案
```

**收益**：
- ✅ 保留 UseCase 的确定性
- ✅ 关键步骤有灵活性
- ✅ 成本可控

**成本**：
- 需要设计何时进入 Agent 模式

---

## 立即可做的改进（不改架构）

### 1. 返回 Screenshot + 完整 AX tree
```typescript
observation = {
  screenshot: base64_image,  // 新增
  elements: ax_tree_with_children  // 增强
}
```

### 2. 提取完整的 AX 属性
- AXValue
- AXSelected
- AXDescription
- AXChildren（层级）
- Available Actions

### 3. 不要过度过滤
- 移除 `width > 50` 限制
- 保留所有有意义的元素
- 让 Claude 判断什么重要

### 4. 支持 element_index
- 为每个元素生成唯一索引
- 支持 `click(element_index)`

### 5. 添加缺失的工具
- Scroll
- Drag
- perform_secondary_action

---

## 结论

**Codex 更灵活、更智能的根本原因**：

不是因为它的代码更聪明，而是因为：
1. ✅ 给 Claude **完整信息**（screenshot + full AX tree）
2. ✅ 给 Claude **控制权**（自主选择定位方式）
3. ✅ 给 Claude **反馈**（每步看到结果）
4. ✅ 信任 Claude 的智能，不是代码的智能

**我们需要的改变**：

不是优化 Capability Chain 的逻辑，而是：
1. ❌ 停止"替 Claude 思考"
2. ✅ 开始"给 Claude 完整的工具"
3. ✅ 让 Claude 自己决策
4. ✅ 我们的代码只负责执行

这不是 QQ Music 的问题，是**架构理念**的问题。
