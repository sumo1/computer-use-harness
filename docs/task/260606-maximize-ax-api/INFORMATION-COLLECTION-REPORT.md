# Codex Computer Use 信息收集完整报告

## 📊 已确认的信息

### 1. 架构设计

**MCP 协议通信**：
```json
// .mcp.json
{
  "mcpServers": {
    "computer-use": {
      "command": "./SkyComputerUseClient",
      "args": ["mcp"]
    }
  }
}
```

**通信方式**：
- stdio（标准输入输出）
- 通过 PIPE 管道：`0 -> PIPE -> 1 -> PIPE -> 2`
- 每个 Codex 对话一个 SkyComputerUseClient 进程

**技术栈**：
- 语言：Swift (arm64)
- 框架：ApplicationServices (Accessibility API)
- 依赖：libswiftCore, libswiftAppKit, libswiftCoreGraphics

### 2. 工具定义（从二进制字符串提取）

**已确认的工具/方法**：
1. `get_app_state` - 获取应用状态
2. `click` - 点击（支持 element_index 或 x,y 坐标）
3. `scroll` - 滚动
4. `type_text` / `type` - 输入文本
5. `perform_secondary_action` - 执行 AX action
6. `set_value` - 设置 AX 元素值
7. `select_text` - 选择文本
8. `press_key` - 按键（支持 xdotool 语法）
9. `drag` - 拖拽

**已确认的参数**：
- `element_index` - AX tree 中的元素索引
- `x`, `y` - 截图像素坐标
- `clicks` - 点击次数
- `button` - 鼠标按钮（left/right/middle）
- `pages` - 滚动页数（支持小数）
- `direction` - 方向（up/down/left/right）

### 3. Codex 的实际操作行为（从对话记录）

**操作序列**：
1. `get_app_state` - 读取初始状态
2. `press_key(Enter)` - 触发搜索
3. `get_app_state` - 读取搜索结果
4. `click` - 点击"专辑"标签 ✅ **成功定位标签**
5. `get_app_state` - 确认切换
6. 多次尝试修改搜索词（失败）
7. `drag` - 拖拽滚动（部分成功）
8. `press_key(Page Down)` - 键盘滚动 ✅ **成功滚动**
9. **读取到日期** - "太阳之子 2026-03-25" ✅ **从 AX tree 读取**
10. `click` - 点击专辑项
11. `get_app_state` - 验证详情页

**关键发现**：
- ✅ 纯 AX 方案（无 screenshot/Vision 提及）
- ✅ 能识别当前激活的标签（"默认是'歌曲'"）
- ✅ 能准确点击"专辑"标签
- ✅ 能从 AX tree 读取日期信息
- ✅ 滚动使用了 3 种方法（AX scroll → drag → keyboard）

---

## ❓ 关键未知信息

### 未知 1：get_app_state 返回什么？

**问题**：
- 是否同时返回 Screenshot + AX tree？
- 还是只返回 AX tree？
- AX tree 的结构是什么？

**需要的证据**：
- [ ] 抓包分析 Codex ↔ API 的数据大小
- [ ] 查看 SkyComputerUseClient 的 screenshot 实现
- [ ] 或直接运行 SkyComputerUseClient 并查看输出

### 未知 2："专辑"标签的 AX 属性

**问题**：
- Role 是什么？（AXButton? AXRadioButton? AXTab?）
- 如何区分"歌曲"和"专辑"标签？
- `AXSelected` 属性的值？

**我们的观察**：
- 我们的 trace 中只找到 1 个按钮元素
- 没有找到明显的标签元素

**需要的证据**：
- [ ] 用 Accessibility Inspector 查看"专辑"标签的完整属性
- [ ] 对比"歌曲"和"专辑"标签的属性差异

### 未知 3：日期信息的位置

**问题**：
- 日期在哪个 AX 属性中？（AXValue? AXDescription? 子元素的 name?）
- 日期文本的 role 是什么？
- 专辑项的层级结构是什么？

**我们的观察**：
- 我们的 trace 中没有找到任何包含"2026"的元素
- 我们过滤掉了 64 个小元素（日期可能在其中）

**需要的证据**：
- [ ] 用 Accessibility Inspector 查看"太阳之子 2026-03-25"这一项的完整结构
- [ ] 查看日期文本在哪个元素中
- [ ] 查看是否是被我们过滤掉的小元素

### 未知 4：SkyComputerUseClient 提取了哪些 AX 属性

**问题**：
- 完整的 AX 属性列表是什么？
- 是否返回子元素（children）？
- 是否返回 available actions？

**需要的证据**：
- [ ] 直接运行 SkyComputerUseClient 并查看输出格式
- [ ] 或通过逆向工程找到属性提取代码

### 未知 5：element_index 如何计算

**问题**：
- Codex 点击"专辑"标签时，使用的是 `element_index` 还是坐标？
- element_index 是如何编号的？（DFS? BFS? 我们的 path?）

**需要的证据**：
- [ ] 运行 SkyComputerUseClient 查看元素编号规则

---

## 🔬 信息收集任务清单

### 优先级 P0（最关键）

#### 任务 A：用 Accessibility Inspector 观察 QQ Music

**你需要做的**：
1. 打开 QQ Music，搜索"周杰伦"
2. 在 Inspector 中定位"专辑"标签
   - 截图完整属性面板
   - 特别关注：Role, Title, Value, Selected, Actions
3. 点击"专辑"后，定位"太阳之子 2026-03-25"这一项
   - 截图完整属性面板
   - 查看日期在哪个字段
   - 截图层级结构（Hierarchy）

**预期收获**：
- 知道"专辑"标签的准确 AX 属性
- 知道日期信息的准确位置
- 知道我们是否遗漏了这些元素

#### 任务 B：直接运行 SkyComputerUseClient

**我可以做的**：
```bash
# 尝试直接运行 SkyComputerUseClient
cd "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/"
./Codex\ Computer\ Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient mcp

# 然后通过 stdin 发送 MCP 请求
# 查看它返回的 AX tree 结构
```

**预期收获**：
- 看到 get_app_state 的完整返回格式
- 看到 AX tree 的结构和属性
- 看到 element_index 的编号规则

#### 任务 C：网络流量分析

**我可以做的**：
```bash
# 抓包分析 Codex 发送的数据
sudo tcpdump -i any -n -s 0 -w /tmp/codex-traffic.pcap host api.openai.com

# 让 Codex 执行一次操作
# 然后分析抓包文件
```

**预期收获**：
- 看到发送的数据大小（判断是否包含截图）
- 看到 AX tree 的实际格式

### 优先级 P1（重要但不紧急）

#### 任务 D：对比我们的 trace 和 Inspector 观察

**基于任务 A 的结果**：
- 检查"专辑"标签在我们 trace 中是否存在
- 检查日期元素在我们 trace 中是否存在
- 如果不存在，分析原因（被过滤？没提取属性？）

#### 任务 E：分析我们的过滤逻辑

**我可以做的**：
```typescript
// 统计分析
- 被过滤的 64 个小元素中有哪些
- 是否包含日期文本
- 是否包含标签按钮
```

---

## 📝 下一步行动

**立即执行（需要你协助）**：
1. ✅ 你：用 Accessibility Inspector 观察 QQ Music（任务 A）
2. ✅ 我：尝试直接运行 SkyComputerUseClient（任务 B）

**等待结果后**：
3. 对比分析（任务 D）
4. 确定改进方向
5. 实现缺失的能力

---

## 💡 当前假设（待验证）

### 假设 1：Codex 同时使用 Screenshot + AX tree
- 依据：Anthropic 文档提到的混合方案
- 待验证：通过任务 B 或 C 确认

### 假设 2："专辑"标签有 `AXSelected` 属性
- 依据：Codex 能识别"默认是'歌曲'"
- 待验证：通过任务 A 确认

### 假设 3：日期在 `AXValue` 或子元素中
- 依据：我们的 trace 中没有日期
- 待验证：通过任务 A 确认

### 假设 4：我们的过滤太激进
- 依据：我们过滤掉了 64 个小元素
- 待验证：通过任务 E 确认

---

**现在开始执行任务 A（你）和任务 B（我）！**
