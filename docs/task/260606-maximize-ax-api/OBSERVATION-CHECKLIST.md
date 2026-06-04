# Accessibility Inspector 观察任务清单

## 目标
对比 Codex 和我们的实现，找出为什么 Codex 能用纯 AX 找到专辑，而我们不能。

## 观察步骤

### 步骤 1：观察 QQ Music 的完整 AX Tree

1. 打开 QQ Music
2. 搜索"周杰伦 专辑"
3. 在 Accessibility Inspector 中：
   - 选择 QQ Music 进程
   - 查看完整的层级结构
   - 记录关键元素的属性

**需要记录的信息**：
- [ ] 搜索结果列表的 AX 结构
- [ ] 专辑标签的 role/name/actions
- [ ] 专辑项的 role/name/value
- [ ] 滚动区域的 role/actions
- [ ] 每个专辑显示的信息（名称、日期）

### 步骤 2：观察 Codex 执行时的 AX 操作

1. 让 Codex 执行"搜索周杰伦最新专辑"任务
2. 同时在 Accessibility Inspector 中观察
3. 记录 Codex 的操作序列

**需要记录**：
- [ ] Codex 点击了哪些元素（记录 role + name）
- [ ] Codex 如何定位"专辑"标签
- [ ] Codex 如何滚动（是否用 AX scroll action）
- [ ] Codex 如何识别专辑列表中的项
- [ ] Codex 如何读取专辑名称和日期

### 步骤 3：运行我们的 UC-102 并对比

```bash
cd /Users/sumo/workplace/opensource/computer-use-harness
./dist/cli/index.js usecases run UC-102 --mac-helper ./native/mac-helper/.build/debug/computer-use-mac-helper > /tmp/uc102-trace.json
```

**分析**：
- [ ] 我们提取了哪些 AX 属性
- [ ] 我们遗漏了哪些关键属性
- [ ] 我们的 AX tree 结构是否完整

### 步骤 4：具体对比点

#### 4.1 搜索框定位
- Codex: 如何找到搜索框？
- 我们: 当前如何找到？
- 差异: ？

#### 4.2 "专辑"标签点击
- Codex: 如何定位"专辑"标签？（role? name? position?）
- 我们: FirstResultClicker 只点第一个，不管是什么
- 差异: ？

#### 4.3 滚动能力
- Codex: 是否用 AXScroll action？
- 我们: 未实现滚动
- 差异: 明确

#### 4.4 专辑列表识别
- Codex: 如何识别哪些是专辑项？
- 我们: 只看 visible elements
- 差异: ？

#### 4.5 日期提取
- Codex: 从哪个 AX 属性读取日期？
- 我们: 依赖 Vision 从截图识别
- 差异: ？

---

## 实际操作记录

### QQ Music AX Tree 结构（待填写）

```
应用窗口
├── 搜索栏
│   ├── role: ?
│   ├── name: ?
│   └── actions: ?
├── 搜索结果区域
│   ├── 标签栏（歌曲/视频/专辑/...）
│   │   ├── "专辑" 标签
│   │   │   ├── role: ?
│   │   │   ├── name: ?
│   │   │   └── selected: ?
│   └── 结果列表
│       ├── role: ?
│       ├── visible children: ?
│       └── 专辑项
│           ├── role: ?
│           ├── name: 专辑名？
│           ├── value: ？
│           └── children: ?
```

### Codex 操作序列（待观察并记录）

```
1. 操作: ?
   - 使用元素: role=?, name=?
   - AX 属性: ?

2. 操作: ?
   - 使用元素: role=?, name=?
   - AX 属性: ?

...
```

### 我们的实现对比（从 trace 中提取）

```
我们提取的 AX 属性:
- role: ✓
- name: ✓
- frame: ✓
- enabled: ?
- value: ?
- children: ?
- actions: ?
- ...

我们遗漏的关键属性:
- ?
- ?
```

---

## 预期发现

基于你的观察"他完全使用 AX 实现了专辑的查找"，我预期会发现：

1. **QQ Music 的 AX 支持可能比我们想象的好**
   - 专辑标签有明确的 AX 标识
   - 专辑列表项有结构化信息
   - 日期可能在某个 AX 属性中

2. **Codex 提取了更多 AX 信息**
   - 不只是 role + name
   - 可能包括 value, description, children
   - 完整的层级树结构

3. **Codex 使用了 AX Actions**
   - 可能用 AXScroll action 滚动
   - 可能用 AXPress action 点击

---

## 下一步

完成观察后，我们需要：

1. **更新 Swift helper**
   - 提取更多 AX 属性
   - 返回层级树而不是扁平列表
   - 提取 available actions

2. **增强 Capabilities**
   - ScrollCapability 使用 AX scroll action
   - AXElementFinder 支持更复杂的查询

3. **改进 UC-102**
   - 基于观察到的 AX 信息重新设计步骤

---

**现在请你：**
1. 用 Accessibility Inspector 观察 QQ Music
2. 让 Codex 执行任务并观察
3. 截图或记录关键发现
4. 把观察结果告诉我

我会等待你的观察结果。
