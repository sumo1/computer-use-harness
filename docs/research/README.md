# Computer Use 深度研究文档索引

## 📁 文档结构

本目录包含对 Anthropic 和 Codex Computer Use 实现的完整研究分析。

---

## 🎯 核心对比分析

### 1. [CORE-ARCHITECTURE-DIFFERENCES.md](./CORE-ARCHITECTURE-DIFFERENCES.md)
**最重要的文档 - 架构哲学差异**

#### 核心发现
- Codex 哲学：**"给 Claude 完整的工具，让它自己思考"**
- 我们的哲学：**"给 Claude 智能的工具，替它思考"**

#### 5 个核心差异
1. 数据源：混合 vs 单一
2. 定位方式：双模式 vs 单一
3. 工作流程：Agent Loop vs 固定步骤
4. 信息完整性：完整 vs 过滤
5. 控制权：Claude 决策 vs 代码决策

#### 对齐方案
- 方案 A：完全对齐（Agent Loop）
- 方案 B：混合模式（UseCase + Agent）
- 方案 C：最小改动（补全能力）

---

## 🔬 技术实现研究

### 2. [ANTHROPIC-COMPUTER-USE-ANALYSIS.md](./ANTHROPIC-COMPUTER-USE-ANALYSIS.md)
**Anthropic 开源实现分析**

#### 技术栈
- Python + PyAutoGUI
- Screenshot only（无 AX tree）
- 图像压缩 + 坐标缩放

#### 核心发现
- 单一 `computer` tool
- 坐标定位 only
- Agent Loop 模式
- Context 管理（image pruning, prompt caching）

#### 源码位置
`anthropic-quickstarts/computer-use-best-practices/`

---

### 3. [CODEX-COMPUTER-USE-ANALYSIS.md](./CODEX-COMPUTER-USE-ANALYSIS.md)
**Codex 闭源实现逆向分析**

#### 架构发现
- MCP (Model Context Protocol) 集成
- Swift 实现，arm64 原生
- **混合方案**：Screenshot + AX tree

#### 10 个工具
```
1. list_apps
2. get_app_state - 返回 Screenshot + AX tree
3. click - 支持 element_index OR x,y
4. perform_secondary_action
5. set_value
6. select_text
7. scroll
8. drag
9. press_key
10. type_text
```

#### 关键设计
- `element_index`（AX 索引）OR `x,y`（坐标）
- Claude 自主选择定位方式
- 混合方案的优势

---

### 4. [CODEX-OPERATION-ANALYSIS.md](./CODEX-OPERATION-ANALYSIS.md)
**Codex 实际操作序列分析**

基于真实对话记录的逐步分析。

#### 操作流程
1. `get_app_state` → 读取状态
2. `click("专辑")` → 成功定位标签 ✅
3. 多次滚动尝试
4. 读取日期 "2026-03-25" ✅
5. 验证详情页

#### 关键发现
- ✅ 纯 AX 方案（无 screenshot/Vision 提及）
- ✅ 能识别激活的标签
- ✅ 能从 AX tree 读取日期
- ✅ 动态探索（滚动查找）

---

## 🔍 深度技术分析

### 5. [BACKGROUND-OPERATION-ANALYSIS.md](./BACKGROUND-OPERATION-ANALYSIS.md)
**后台操作能力分析**

#### 核心技术
```json
{
  "LSUIElement": true
}
```

#### 实现原理
- AX Actions（后台，优先）
- CGEvent 点击（前台，降级）
- 不干扰用户工作

#### 合理性
- ✅ macOS 设计初衷
- ✅ 辅助技术的标准用法
- ✅ 需要用户授权
- ✅ 业界最佳实践

---

### 6. [VIRTUAL-CURSOR-ANALYSIS.md](./VIRTUAL-CURSOR-ANALYSIS.md)
**虚拟光标实现分析**

#### 结论
- ❌ 不是独立功能
- ❌ 不是 AX 能力
- ✅ 可能是 UI overlay
- ✅ 纯视觉反馈

#### 证据
- 工具列表无 `mouse_move`
- 二进制无光标绘制代码
- Anthropic 有 `mouse_move`，Codex 没有

#### 建议
- 不需要实现
- 非核心能力
- 可选的 UI 层功能

---

## 📋 信息收集报告

### 7. [INFORMATION-COLLECTION-REPORT.md](./INFORMATION-COLLECTION-REPORT.md)
**系统性信息收集计划**

#### 已确认的信息
- MCP 协议 stdio 通信
- Swift + ApplicationServices
- 混合方案（Screenshot + AX）

#### 关键未知（待验证）
- get_app_state 返回格式细节
- "专辑"标签的准确 AX 属性
- 日期在 AX tree 中的位置
- element_index 编号规则

#### 收集任务
- 任务 A：Accessibility Inspector 观察
- 任务 B：直接运行 SkyComputerUseClient ✅
- 任务 C：网络流量分析

---

### 8. [TASK-B-COMPLETE.md](./TASK-B-COMPLETE.md)
**任务 B 完成报告**

#### 重大发现
```
get_app_state: "return a screenshot and accessibility tree"
```

✅ **混合方案确认！**

#### click 工具参数
```json
{
  "element_index": "string",  // AX 索引
  "x": "number",              // 截图坐标
  "y": "number"
}
```

Claude 自主选择！

---

### 9. [CURRENT-GAPS.md](./CURRENT-GAPS.md)
**我们当前的差距分析**

#### 缺失的 AX 属性
- ❌ AXValue
- ❌ AXSelected
- ❌ AXDescription
- ❌ AXChildren（层级）
- ❌ AXActions

#### 架构问题
- ❌ 没有返回 screenshot
- ❌ 没有 element_index 系统
- ❌ 过滤太激进（丢失日期）
- ❌ 扁平列表（非树结构）

---

### 10. [OBSERVATION-CHECKLIST.md](./OBSERVATION-CHECKLIST.md)
**Accessibility Inspector 观察清单**

观察任务模板（待用户完成）。

---

### 11. [ACTION-PLAN.md](./ACTION-PLAN.md)
**深入研究 AX API 的行动计划**

5 个阶段的详细计划。

---

## 📊 对比总结

### Anthropic vs Codex vs 我们

| 维度 | Anthropic | Codex | 我们 |
|------|-----------|-------|------|
| **数据源** | Screenshot only | Screenshot + AX tree | AX tree only |
| **定位** | 坐标 only | element_index OR 坐标 | Capability Chain |
| **工作流** | Agent Loop | Agent Loop | UseCase 固定步骤 |
| **语言** | Python | Swift | Swift + TypeScript |
| **协议** | Tool Call | MCP | 自定义 |
| **后台操作** | 需要前台 | ✅ 后台（AX） | 部分后台 |

---

## 🎯 核心洞察

### 为什么 Codex 更智能？

**不是因为代码更聪明，而是因为**：
1. ✅ 给 Claude **完整信息**（Screenshot + full AX tree）
2. ✅ 给 Claude **控制权**（选择定位方式）
3. ✅ 给 Claude **反馈**（Agent Loop）
4. ✅ 信任 Claude 的智能 > 代码的智能

### 我们需要改变什么？

**哲学转变**：
- ❌ 停止"替 Claude 思考"
- ✅ 开始"给 Claude 完整的工具"
- ✅ 让 Claude 自己决策
- ✅ 我们的代码只负责执行

---

## 🚀 下一步

### 立即可做（方案 C）
1. 返回 Screenshot + 完整 AX tree
2. 提取所有 AX 属性
3. 支持 element_index
4. 添加 scroll/drag 工具
5. 不过度过滤

### 架构调整（方案 B）
- UseCase + Agent 混合模式
- 关键步骤进入 Agent Loop

### 完全重构（方案 A）
- Agent Loop
- 简化工具
- 对齐 Codex 架构

---

## 📚 参考资源

### 外部资源
- [Anthropic Computer Use Quickstarts](https://github.com/anthropics/anthropic-quickstarts)
- macOS Accessibility Programming Guide
- Model Context Protocol (MCP) Specification

### 内部文档
- `/docs/CAPABILITY-MATRIX.md` - 能力矩阵
- `/docs/how-to-add-new-app.md` - App 接入指南
- `/docs/engineering/conventions.md` - 工程规范

---

## 📝 文档元信息

- **研究时间**: 2026-06-03
- **研究方法**: 
  - 二进制逆向分析
  - MCP 协议交互
  - 对话记录分析
  - 源码对比
- **研究对象**:
  - Codex Computer Use (SkyComputerUseClient)
  - Anthropic computer-use-best-practices
  - 我们的 computer-use-harness
- **研究成果**: 完整的架构差异分析和对齐方案
