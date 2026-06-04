# ✅ 任务 B 完成：SkyComputerUseClient 工具定义分析

## 重大发现

### get_app_state 返回内容

**官方描述**：
> "Start an app use session if needed, then get the state of the app's key window and **return a screenshot and accessibility tree**."

**结论**：✅ **混合方案确认！**

Codex 同时返回：
1. Screenshot（截图）- 用于视觉理解和坐标定位
2. Accessibility Tree（AX树）- 用于结构化信息和精确操作

---

## 完整工具列表（10个工具）

### 1. list_apps
- 列出计算机上的应用
- 返回正在运行的和最近14天使用的应用

### 2. get_app_state ⭐
- **返回**: screenshot + accessibility tree
- **用途**: 每轮必须先调用获取最新状态
- **参数**: app（应用名/路径/bundle ID）

### 3. click ⭐
**支持两种定位方式**：
```json
{
  "element_index": "string",  // AX tree 索引
  "x": "number",              // 截图像素坐标
  "y": "number",
  "click_count": 1,
  "mouse_button": "left|right|middle"
}
```

**关键**：Claude 自主选择用哪种方式！

### 4. perform_secondary_action
- 调用 AX 元素的辅助 actions
- 例如：AXShowMenu, AXIncrement

### 5. set_value
- 设置可设置的 AX 元素值
- 用于文本框、slider 等

### 6. select_text
- 选择文本元素内的文本
- 或放置光标
- 需要提供 AX tree 中的精确文本

### 7. scroll
- 滚动元素
- 支持方向和页数（可能支持小数）

### 8. drag
- 使用像素坐标拖拽
- 从一点到另一点

### 9. press_key
- 按键或组合键
- 支持 xdotool 语法
- 例如："Return", "super+c", "Up"

### 10. type_text
- 输入文字字符

---

## 关键洞察

### 洞察 1：混合方案的优势

**为什么同时返回 Screenshot 和 AX Tree**：

1. **AX Tree 提供结构化信息**：
   - Role, name, value, selected 等属性
   - 层级关系
   - Available actions
   - 语义化，准确

2. **Screenshot 提供视觉信息**：
   - 布局和位置
   - 当 AX 信息不足时的降级方案
   - 坐标定位

3. **Claude 自主决策**：
   - AX tree 信息丰富 → 用 `element_index`（快速、准确）
   - AX tree 信息不足 → 用 `x, y` 坐标（降级）

### 洞察 2：element_index 的重要性

**Codex 成功点击"专辑"标签的原因**：
- Codex 看到了 screenshot（理解视觉布局）
- Codex 看到了 AX tree（获得精确的 element_index）
- Codex 使用 `click(element_index="XX")` 精确点击

**我们为什么失败**：
- 我们没有返回 screenshot
- 我们的 AX tree 可能遗漏了关键元素或属性
- 我们没有支持 `element_index` 定位方式

### 洞察 3：坐标系统

**"X coordinate in screenshot pixel coordinates"**

这说明：
- 坐标是基于截图的像素坐标
- 不是屏幕坐标
- 如果截图被缩放，坐标需要对应缩放

（与 Anthropic 的实现一致）

---

## 我们需要实现的

### P0 - 立即需要

1. **返回 Screenshot**
   - 已实现 ✅
   - 需要确保格式正确

2. **返回完整的 AX Tree**
   - 提取更多属性（AXValue, AXSelected, AXDescription）
   - 返回层级结构（children）
   - 提取 available actions

3. **支持 element_index 定位**
   - 为每个元素生成唯一索引
   - 支持通过索引查找元素
   - 实现 click by index

4. **提取日期信息**
   - 确保日期文本在 AX tree 中
   - 可能在 AXValue 或子元素中

### P1 - 重要

5. **Scroll capability**
6. **Drag capability**
7. **perform_secondary_action**
8. **set_value**
9. **select_text**

---

## 下一步

### 等待任务 A 结果（你的观察）

你用 Accessibility Inspector 观察后，我们可以：
1. 确认"专辑"标签的准确属性
2. 确认日期的准确位置
3. 对比我们的 trace 找出差距
4. 立即实现缺失的能力

### 立即可以开始的

基于已知信息，我可以开始：
1. 设计 element_index 生成规则
2. 设计 AX tree 返回格式（包含 children）
3. 准备提取 AXValue, AXSelected 等属性的代码

---

**现在等待你完成任务 A（Accessibility Inspector 观察）！**
