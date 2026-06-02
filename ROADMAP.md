# computer-use-harness Roadmap

## 拆分原则

先做端到端验证层，再向下填实现。

任务描述只记录：

- 要支持的用户场景。
- 关键能力。
- 成功/失败信号。
- 不变量。

任务描述不记录：

- 临时函数名。
- 内部文件路径。
- 未冻结的数据字段全集。
- 某一版 adapter 的实现细节。

这样底层实现调整时，不需要连带修改所有上层任务。

## 第一层：Use Case List

第一步不是写 Mac helper，也不是写 adapter，而是先定义端到端 use cases。

目标文件：

```text
usecases/cases.yaml
```

每个 case 只描述：

```yaml
id: UC-030
title: Click a visible button in a local app
requires:
  platform: macos
  permissions:
    - accessibility
steps:
  - open app
  - read app state
  - find button by role/name
  - click button
  - read app state again
success:
  - action result is ok
  - trace contains observation/action/result
  - app state changed or verifier confirms click effect
```

不要在 use case 里写 Swift 类名、TS 函数名、AX 细节。

## Use Case 初始清单

| ID | 场景 | 核心能力 |
|---|---|---|
| UC-001 | 诊断本机权限 | 检查 Accessibility / Screen Recording / helper 状态 |
| UC-010 | 列出 App 和能力 | app registry / capability visibility |
| UC-020 | 打开 App 并读取窗口 | open app / list windows / app state |
| UC-030 | 找按钮并点击 | find element / click / verify |
| UC-040 | 找输入框并输入 | find input / set value or type / verify |
| UC-050 | 浏览器走 browser-harness | browser adapter / state / click |
| UC-060 | 禁止操作受保护目标 | policy guard / blocked action |
| UC-070 | 所有动作写 trace | trace JSONL / artifact path |
| UC-080 | 权限缺失时可解释失败 | permission error / doctor hint |
| UC-090 | IDEA 基础 UI 操作 | JetBrains-specific + AX fallback |

这些 use cases 是第一版的顶层契约。下面所有实现任务都只需要引用这些 ID。

## 任务拆分

### Task 1 - Use Case Harness

目标：建立端到端验证模块。

能力：

- 读取 `usecases/cases.yaml`。
- 支持 dry-run，列出每个 case 的前置条件和步骤。
- 支持 fake adapter，先不依赖真实 macOS UI。
- 输出统一验证结果。

验收：

- `computer-use usecases list` 能列出初始清单。
- `computer-use usecases run UC-030 --fake` 能跑通假实现。
- 输出包含 case id、status、step results、trace id。

### Task 2 - CLI Skeleton

目标：建立最薄 CLI。

能力：

- 参数解析。
- 默认 JSON 输出。
- `--pretty` 人类可读输出。
- 稳定 exit code。
- stdout 只输出结构化结果，包括 `ok: false` 的业务错误。
- 日志、调试信息和非协议噪声输出到 stderr。

验收：

- `computer-use --help`
- `computer-use version`
- `computer-use usecases list`
- CLI 不直接调用 macOS API。

### Task 3 - Core Contracts

目标：冻结最小公共协议。

能力：

- Target
- Observation
- ElementRef
- Action
- ActionResult
- TraceEvent
- AppCapability

验收：

- fake adapter、CLI、usecase runner 都使用同一套 contract。
- contract 不依赖 Node、macOS、browser-harness。

### Task 4 - Trace Runtime

目标：先把可调试性做出来。

能力：

- 每个 run 有 trace id。
- 每步记录 observation/action/result。
- artifact 路径可记录。
- 支持 `computer-use trace --last`。

验收：

- fake use case 也会产生 trace。
- 失败 case 能从 trace 定位失败步骤。

### Task 5 - Policy Guard

目标：动作执行前先过 policy。

能力：

- blocked targets。
- confirm-required actions。
- allowed app list。
- denied app list。

验收：

- UC-060 能阻止当前终端、Claude Code/Codex 自身、系统安全弹窗。
- policy decision 写入 trace。

### Task 6 - App Capability Registry

目标：调用前先知道 App 支持什么。

能力：

- `computer-use apps --json`
- `computer-use capabilities --app <name>`
- support level: blocked/custom/automation/generic/screen
- fallback path。

验收：

- Safari/browser 使用 browser-harness adapter。
- IDEA 显示 automation + AX fallback。
- Terminal 显示 blocked。

### Task 7 - Mac Helper Protocol

目标：定义 TS 和 Swift helper 的边界。

能力：

- JSON-RPC over stdio。
- permissionStatus。
- listApps。
- listWindows。
- getAppState。
- click/type/key/scroll。

验收：

- TS 侧能通过 fake helper 跑 UC-020/030/040。
- helper 协议不暴露 AXUIElement 内部细节。

### Task 8 - Mac Helper Minimal Implementation

目标：接入真实 macOS 能力。

能力：

- Accessibility permission check。
- Screen Recording permission check。
- list running apps。
- list windows。
- get accessibility tree。
- action request validation for click/type/key/scroll。

验收：

- UC-001/010/020 在本机真实 Mac 上可运行。
- 权限缺失时返回可解释错误。
- action 方法在真实执行前返回稳定 `ActionResult` 失败语义。
- CLI native runner 可通过 `--mac-helper <path>` 把 helper action failure 写入 trace。

### Task 9 - Mac Actions

目标：让通用 App 可操作。

能力：

- click by element ref。
- type text。
- set value。
- press key。
- scroll。
- screenshot fallback。

验收：

- UC-030/040 在至少一个系统 App 上跑通。
- element ref 过期后能返回明确错误。

### Task 10 - Browser Harness Adapter

目标：浏览器能力接本地 browser-harness。

能力：

- browser state。
- browser click。
- browser type。
- browser navigate。
- browser trace integration。

验收：

- UC-050 通过本地 browser-harness 跑通。
- browser adapter 不直接依赖 Mac helper。

### Task 11 - Agent Skills

目标：让 Claude Code / Codex 通过 skill 调 CLI。

能力：

- Claude Code skill。
- Codex skill。
- 说明何时调用。
- 说明 JSON 输出如何解析。
- 说明高风险动作确认规则。

验收：

- Claude Code 能通过 shell 调 `computer-use` 完成 UC-030 或 UC-040。
- skill 不实现 native 能力，只调用 CLI。

## 当前第一步

先实现 Task 1。

不要先写 Swift helper。没有 use case harness，后面实现会变成“感觉差不多能点了”，这不是工程。
