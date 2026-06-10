# Task: React Loop Computer Use Runtime

## 核心判断

值得做。

当前问题不是某个 QQ 音乐 case 没写好，而是 computer-use runtime 的执行模型还不够像真正的 agent loop：它太容易把“目标理解、页面理解、下一步决策、动作验证”压进静态规则。继续补 case-specific 规则只会让系统越来越脆。

本任务的目标是把 harness 推向一个通用闭环：

```text
event/goal
  -> observe
  -> decide next action
  -> execute action
  -> observe again
  -> verify action effect
  -> repeat until goal is done or blocked
```

端到端验证是唯一通过标准。没有真实或可回放的 E2E trace，就不能声明完成。

## 目标

1. 实现通用的 `observe -> action -> observe -> verify` 执行循环。
2. 默认使用 AX 树做页面理解和元素绑定，截图/OCR 只作为补充证据。
3. 引入可审计的 virtual pointer：它是 trace 和截图 overlay 中的可视化状态，不是第二个 macOS 系统鼠标。
4. 把输入执行后端分层，避免把全局 HID 当成默认路径。
5. 让自由原子动作和 usecase runner 都能复用同一套动作执行、验证和 trace 结构。
6. 清理或隔离历史 app-specific 分支，不能再为某个 case 添加专用推理路径。

## 非目标

1. 不实现一个独立的 macOS 虚拟鼠标设备。
2. 不把 QQ 音乐、飞书、Multica、Finder 写成专用 planner。
3. 不要求第一阶段有透明置顶窗口；静态 screenshot overlay 和 trace 元数据先够用。
4. 不破坏现有 `usecases run`、`computer-use action` 和顶层原子命令。
5. 不把截图提升为默认主观测源；AX 优先级必须高于视觉。

## 关键数据结构

### Action Trace

每一步 action 都必须有统一结构：

```ts
interface ActionTraceStep {
  stepId: string;
  goalId?: string;
  action: NormalizedAction;
  before: Observation;
  execution: ActionExecutionResult;
  after: Observation;
  verification: ActionVerificationResult;
  virtualPointer?: VirtualPointerState;
}
```

### Virtual Pointer

`virtualPointer` 只表达 harness 认为自己正在指向哪里，用于审计和 replay：

```ts
interface VirtualPointerState {
  x: number;
  y: number;
  coordinateSpace: "screen" | "window" | "element";
  targetElementId?: string;
  source: "ax-bounds" | "vision" | "explicit-coordinate" | "inferred";
  visibleInOverlay: boolean;
}
```

### Input Backend

动作执行结果必须记录真实使用的输入后端：

```ts
type InputBackend =
  | "ax-semantic"
  | "app-targeted-event"
  | "global-hid";

interface InputBackendMetadata {
  backend: InputBackend;
  method: string;
  pointerImpact: "none" | "target-app" | "global";
  permissionUsed: Array<"accessibility" | "screen-recording" | "input-monitoring">;
  fallbackFrom?: InputBackend;
}
```

后端优先级固定：

1. `ax-semantic`: `AXPress`、`AXSetValue`、AX scroll/action。
2. `app-targeted-event`: `CGEvent.postToPid(pid)`，只投递给目标 app。
3. `global-hid`: `.cghidEventTap`，最后 fallback，必须在 trace 中标成高影响路径。

## 决策循环

Planner 不应该知道“QQ 音乐最新专辑”这种业务特例。它只做通用事情：

1. 从 goal/event 中抽取当前意图和成功条件。
2. 读取 observation，优先解析 AX tree。
3. 判断当前状态是否已经满足目标。
4. 如果未满足，选择一个可解释的下一步 action。
5. 执行动作后重新 observe。
6. 用前后 observation 对比验证动作是否生效。
7. 证据不足时继续探索，例如滚动、切 tab、打开详情页，但每一步都必须来自当前 observation。

滚动不是“QQ 音乐专辑页的规则”，而是通用探索动作：

```text
当候选结果不足以证明目标、页面存在可滚动区域、且目标需要比较更多候选时，
planner 可以选择 scroll。
scroll 后必须观察页面是否真的变化；没变化就换后端、换区域或标记 blocked。
```

## 实施步骤

### Phase 1: Trace Contract

- [ ] 在核心 contract 中扩展 action trace 元数据。
- [ ] 每个原子动作记录 `before`、`after`、`verification`、`inputBackend`、`virtualPointer`。
- [ ] 保持现有返回字段兼容，新增字段只放进可选 metadata。

### Phase 2: Input Backend Router

- [ ] 把 AX、app-targeted event、global HID 的选择集中到一个 router。
- [ ] 默认尝试 AX semantic action。
- [ ] AX 不可用或不可验证时，降级到 app-targeted event。
- [ ] global HID 只作为最后 fallback，并在结果中显式标记。
- [ ] 保留历史特化 fallback，但移动到兼容层或标记 deprecated，不能进入 planner。

### Phase 3: Observe-Action-Observe-Verify Loop

- [ ] 自由原子命令和 usecase runner 共用同一个 action runner。
- [ ] action 后强制重新 observe。
- [ ] verification 只基于 `before/after` 和显式目标条件，不靠 case 名称判断。
- [ ] 支持 action 失败后的可解释 blocked 状态。

### Phase 4: Virtual Pointer Overlay

- [ ] 从 AX bounds、视觉定位或显式坐标生成 `virtualPointer`。
- [ ] trace/replay 中展示 virtual pointer。
- [ ] 可选生成 screenshot overlay artifact，用于人工审计。
- [ ] overlay 失败不能影响真实动作执行，但必须记录诊断信息。

### Phase 5: E2E Validation

- [ ] 新增或更新 E2E 脚本，验证完整闭环。
- [ ] 不依赖 `cases.yaml` 预定义用例才能执行原子动作。
- [ ] 验证 AX-first 路径、后端降级路径、滚动探索路径和截图 overlay 路径。

## E2E 验收标准

所有验收都必须产出 trace artifact。只跑单元测试不算通过。

### Case A: 原子动作闭环

目标：对一个可控 fixture 或测试 app 执行 `click/type/key/scroll`。

通过标准：

- trace 中每个动作都有 `before -> execution -> after -> verification`。
- `verification.status` 不能是空值。
- `inputBackend.backend` 存在。
- `virtualPointer` 存在，并能映射到被操作元素或坐标。

### Case B: AX 优先

目标：在 Electron/Web 内容较深的 AX tree 中定位并操作文本框或按钮。

通过标准：

- observation 暴露真实 UI 元素，不只看到外层空 AXGroup。
- 元素绑定来自 AX tree。
- 没有 Screen Recording 权限时，AX-only 动作仍可执行。

### Case C: 滚动探索

目标：在列表中寻找“最大/最新/最高热度”这类需要比较多个候选的结果。

通过标准：

- planner 不能只看首屏就结束。
- 当证据不足时必须执行 scroll 或给出明确 blocked 原因。
- scroll 后必须验证页面内容发生变化。
- 最终答案必须引用已观察到的候选集合和比较依据。

### Case D: 后端降级

目标：模拟 AXPress 不可用但坐标可用的元素点击。

通过标准：

- 先尝试 `ax-semantic`。
- 降级到 `app-targeted-event`。
- 如果触发 `global-hid`，trace 必须标记 `pointerImpact: "global"`。
- 降级原因可读，不能静默吞掉。

### Case E: 非定制真实应用 smoke

目标：选择一个低风险真实 macOS 应用完成闭环，例如 TextEdit 创建临时文本、Finder 读取目录 UI、或本地 Electron fixture。

通过标准：

- 不写 app-specific planner。
- 不要求账号、不发送真实外部消息、不破坏用户数据。
- trace 可回放，可解释每一步为什么执行。

## 失败条件

以下情况直接判定任务未完成：

1. 新增 QQ 音乐、飞书、Multica 专用 planner 分支。
2. 动作执行后不重新 observe。
3. 只用截图猜结果，AX tree 明明可用却不优先使用。
4. 滚动后不验证页面变化。
5. global HID 被默认使用且没有 trace 标记。
6. 没有端到端 trace artifact。

## 交付物

1. contract 扩展：trace、virtual pointer、input backend、verification。
2. input backend router。
3. 统一 action runner 闭环。
4. screenshot overlay 或等价 trace replay 可视化。
5. E2E 验证脚本和产物。
6. README/SKILL.md 更新，说明自由原子动作和目标模式如何使用。

## 推荐执行顺序

1. 先补 trace contract，不动 planner。
2. 再集中输入后端选择，消除散落 fallback。
3. 然后强制 action 后 observe 和 verification。
4. 最后做 virtual pointer overlay。
5. 每个 phase 都跑对应 E2E，不等最后一次性验证。

## 当前状态

第一轮通用闭环已经落地：

- 核心 contract 已新增 `ActionTraceStep`、`InputBackendMetadata`、`VirtualPointerState`、`ActionVerificationResult`。
- 自由原子动作 runner 和 native usecase runner 都会在 result trace event 上附加 `actionTraceStep`。
- macOS helper 会在成功动作结果中标准化输出 `inputBackend` 元数据。
- click 执行路径已改成通用后端顺序：AX semantic -> app-targeted `postToPid` -> frontmost-verified global HID。
- type/key 执行路径已去掉 QQ 音乐和 Sublime Text 特化，改成同一套通用后端顺序。
- screenshot vision 已去掉旧的周杰伦专辑示例，改成 query-driven 的通用抽取提示。
- CLI target 创建会通过 app registry 解析别名，例如 `Finder` 会解析为 `com.apple.finder`。
- result metadata 会附加 compact `actionTraceStep` 摘要；当 observation 有 screenshot 时，会生成 SVG virtual pointer overlay。
- virtual pointer trace 保留屏幕坐标，overlay 会映射到窗口截图坐标。
- E2E 验证已覆盖原子动作、目标模式循环，以及低风险真实 Finder smoke。

剩余工作不应回到 case-specific planner，而应把 trace overlay 接到 replay/UI 展示层，并继续扩大真实应用 smoke 覆盖。
