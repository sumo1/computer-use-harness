# Roadmap

computer-use-harness 按 use case 推进，不按文件、类名或 adapter 细节推进。

原因很简单：computer-use 的风险不在某个函数，而在整条链路是否可控。

每个阶段都必须回答四个问题：

- 用户场景是什么？
- 成功信号是什么？
- 失败信号是什么？
- 会不会破坏 policy、trace 或 JSON contract？

## 拆分原则

### 1. 先协议，后能力

真实点击和输入不是第一步。

第一步是 Target、Observation、Action、ActionResult、PolicyDecision、TraceEvent 这些协议稳定下来。协议不稳，真实动作越早接入，后面越难修。

### 2. 先 fake，再 native

fake runner 用来验证 CLI、trace、policy 和 use case harness。

native runner 用来验证 Swift helper 的真实 stdio 边界和失败语义。

真实 UI action 必须排在这两层之后。

### 3. 先失败语义，后成功路径

一个可靠的 computer-use runtime，必须先知道怎么失败：

- 权限缺失。
- target 不合法。
- action 被 policy 拦截。
- element ref 过期。
- adapter 不支持。
- helper 未实现。

失败码稳定之后，成功路径才值得接。

### 4. Browser 和 native 分开

浏览器走 browser-harness。

本地 App 走 mac helper 或 app-specific adapter。

runtime 统一协议，但 adapter 不互相污染。

## Use Case List

Use case 是项目顶层契约，定义在：

```text
usecases/cases.yaml
```

| ID | 场景 | 核心能力 |
|---|---|---|
| UC-001 | 诊断本机权限 | Accessibility / Screen Recording / helper status |
| UC-010 | 列出 App 和能力 | app registry / capability visibility |
| UC-020 | 打开 App 并读取窗口 | open app / list windows / app state |
| UC-030 | 找按钮并点击 | find element / click / verify |
| UC-040 | 找输入框并输入 | find input / set value or type / verify |
| UC-050 | 浏览器走 browser-harness | browser adapter / state / click |
| UC-060 | 禁止操作受保护目标 | policy guard / blocked action |
| UC-070 | 所有动作写 trace | trace JSONL / artifact path |
| UC-080 | 权限缺失时可解释失败 | permission error / doctor hint |
| UC-090 | IDEA 基础 UI 操作 | JetBrains-specific + AX fallback |

## Milestones

### M1. CLI Harness

目标：能在没有真实 UI 权限的情况下验证端到端协议。

包含：

- use case loader。
- `usecases list`。
- `usecases dry-run`。
- `usecases run --fake`。
- 默认 JSON 输出。
- 稳定 exit code。

状态：Done。

### M2. Core Runtime

目标：把 computer-use 的核心对象冻结成最小公共协议。

包含：

- `Target`
- `Observation`
- `ElementRef`
- `Action`
- `ActionResult`
- `TraceEvent`
- `PolicyDecision`
- `AppCapability`

状态：Done。

### M3. Trace And Policy

目标：每一步都可审查，危险动作先被 runtime 拦住。

包含：

- JSONL trace。
- `trace --last`。
- blocked target table。
- policy decision 写入 trace。
- UC-060 blocked path。

状态：Done。

### M4. Capability Registry

目标：调用前先知道 App 支持什么能力。

包含：

- `apps`
- `capabilities --app <name>`
- support level。
- fallback path。
- blocked app visibility。

状态：Done。

### M5. Mac Helper Protocol

目标：定义 TS 和 Swift helper 的稳定边界。

包含：

- JSON-RPC over stdio。
- `permissionStatus`
- `listApps`
- `listWindows`
- `getAppState`
- `click/type/key/scroll`
- TS fake helper client。
- TS stdio helper client。

状态：Done。

### M6. Mac Helper Minimal Implementation

目标：接入真实 macOS 查询能力，但不执行真实 UI action。

包含：

- Swift package。
- 长连接 JSONL stdio loop。
- permission status。
- running apps。
- windows。
- app state。
- action request validation。
- stable `ActionResult` failure。
- CLI `--mac-helper <path>` native runner。
- native action failure 写入 trace。

状态：In progress。

剩余：

- 基础 accessibility tree。
- 更明确的 permission hint。
- helper smoke scripts。

### M7. Real Mac Actions

目标：让普通本地 App 可以被安全操作。

包含：

- element ref lookup。
- element stale error。
- click by element ref。
- type text。
- set value。
- press key。
- scroll。
- screenshot fallback。

验收：

- UC-030 在一个系统 App 上跑通。
- UC-040 在一个系统 App 上跑通。
- element ref 过期时返回稳定错误码。
- 所有真实 action 先经过 policy。
- 所有真实 action 写 trace。

状态：Not started。

### M8. Browser Harness Adapter

目标：浏览器能力接入统一协议。

包含：

- browser state。
- browser click。
- browser type。
- browser navigate。
- browser trace integration。

验收：

- UC-050 通过本地 browser-harness 跑通。
- browser adapter 不依赖 Mac helper。

状态：Not started。

### M9. Agent Skills

目标：让 Claude Code / Codex 稳定调用 CLI。

包含：

- Claude Code skill。
- Codex skill。
- JSON result reading rules。
- policy blocked handling rules。
- trace inspection workflow。

状态：Not started。

## Agent Roles

### Human Operator

负责授权、调试、验收真实机器行为。

不变量：

- 真实 action 打开前必须明确知道会影响哪个 App。
- 不能为了 demo 绕过 policy。

### Coding Agent

负责读 JSON、调 CLI、根据 trace 修代码。

不变量：

- 不解析 stdout 里的自然语言。
- 不在 policy blocked 后尝试绕过 runtime。
- 不直接调用 Swift helper 绕过 CLI。

### Computer-Use Runner

负责把 use case step 转成 action，并写 trace。

不变量：

- 每个 action 都有 target。
- 每个 result 都进入 trace。
- helper transport error 和 action failure 不能混淆。

### Policy Guard

负责动作前置裁决。

不变量：

- blocked target 永远优先于 adapter。
- decision 必须可审查。
- confirm-required 不能静默当 allowed。

### Native Helper

负责 macOS 系统 API。

不变量：

- 只暴露 JSON-RPC 协议。
- 不泄漏 AXUIElement 内部对象。
- 权限缺失必须返回稳定错误。

### Browser Adapter

负责把 browser-harness 接进统一 contract。

不变量：

- 不重写浏览器自动化。
- 不依赖 mac helper。
- browser trace 和 native trace 使用同一套事件模型。

## Definition Of Done

一个 milestone 完成，不是“代码写了”，而是：

- CLI 可运行。
- JSON contract 稳定。
- trace 可读。
- 失败路径有明确 error code。
- fake 或 native smoke 至少覆盖一个 use case。
- README 和 ROADMAP 不说谎。
