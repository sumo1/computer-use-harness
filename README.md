# computer-use-harness

A CLI-first computer-use harness for agents.

让 Claude Code、Codex、shell 脚本和未来 MCP 工具，以同一套协议安全地观察和操作本机应用。

## 核心判断

AI agent 真的要进入桌面环境时，最大问题不是“怎么点一下按钮”。

真正昂贵的是：

**如何让一个 agent 在真实机器上行动时，可解释、可追踪、可拦截、可复现。**

裸调用 Accessibility API 或屏幕坐标点击很容易做出 demo，也很容易把机器点坏。真正能长期使用的 computer-use runtime，需要把动作拆成几件一等公民：

- **Target**：要操作谁，不允许含糊。
- **Observation**：看到了什么，来源是什么。
- **Action**：准备做什么，走哪个 adapter。
- **Policy**：这一步是否允许，为什么。
- **ActionResult**：结果是什么，失败码是否稳定。
- **Trace**：整条链路能不能回放和审查。

computer-use-harness 的立场很简单：

**电脑操作不是 prompt 技巧，而是一个本地执行系统。**

它必须像工程系统一样，有协议、有边界、有日志、有失败语义。否则今天能点按钮，明天就能误删东西。

## 这个项目是什么

computer-use-harness 是一个 Mac 优先的本地 computer-use runtime，第一形态是 CLI。

它不是桌面 App，不是浏览器自动化库，也不是某个 agent 的私有插件。

它要做的是一层可复用的本地执行底座：

```text
Claude Code / Codex / shell / future MCP
  -> computer-use CLI
  -> policy guard
  -> capability registry
  -> adapter
  -> Swift mac helper / browser-harness
  -> ActionResult
  -> trace
```

第一版重点是把协议和安全边界做稳。真实 macOS UI 动作会逐步打开，但不会在 policy、trace、错误码之前打开。

## 现在能做什么

当前仓库已经具备：

- TypeScript CLI skeleton。
- 机器可读 JSON 输出。
- 稳定 command error code 和 exit code。
- Use case harness。
- fake runner。
- JSONL trace runtime。
- policy guard。
- app capability registry。
- TS / Swift helper protocol。
- Swift native helper scaffold。
- native helper stdio JSON-RPC 长连接。
- native runner，通过 `--mac-helper <path>` 把 helper action failure 写入 trace。

当前 Swift helper 支持：

- `permissionStatus`
- `listApps`
- `listWindows`
- `getAppState`
- `click/type/key/scroll` 的请求校验和稳定失败返回

当前还不会执行真实 UI 动作。合法 action 会被验证，然后返回 `UNIMPLEMENTED`。这是刻意的安全边界。

## 什么时候用

适合：

- 你正在研究或构建 agent 操作本地电脑的能力。
- 你需要 CLI-first，而不是先做一个 GUI app。
- 你关心 trace、policy、错误码和可复现性。
- 你希望 browser automation 和 native app automation 最终走同一套协议。
- 你想让 Claude Code / Codex 通过 shell 或 MCP 稳定调用本地 computer-use 能力。

不适合：

- 只想要一个马上能点屏幕坐标的 demo。
- 只做浏览器自动化，Playwright 已经够用。
- 不关心本地权限、安全边界和 trace。
- 想把 macOS Accessibility 调用直接塞进 agent prompt。

最后一种不是工具问题，是事故迟早问题。

## 设计哲学

### 1. CLI 是 runtime SSOT

agent-specific skill 只是薄包装。

真正的能力应该落在 CLI runtime 里，这样 Claude Code、Codex、人类 shell、CI smoke 和未来 MCP 都能复用同一套行为。

```text
Runtime SSOT = CLI
Agent UX = skill / plugin / MCP wrapper
```

### 2. Policy 先于动作

任何真实 action 都必须先经过 policy guard。

受保护目标、当前终端、agent 自身、安全弹窗、系统设置等目标不能靠“agent 自觉”避开。该挡的动作必须在 runtime 层挡住，并写入 trace。

### 3. Trace 不是调试附属品

Trace 是核心产品能力。

每一步都应该能回答：

- 当时 target 是谁？
- 观察来自哪里？
- policy 为什么允许或拒绝？
- action 走哪个 adapter？
- 失败码是什么？
- 下一次怎么复现？

没有 trace 的 computer-use，只是一次性魔法。

### 4. Native 能力要隔离

TypeScript 适合写 CLI、协议、trace、policy、adapter 调度。

macOS Accessibility、Screen Recording、CGEvent、窗口枚举和权限检测应该放在 Swift helper 里。

TS 编排，Swift 触系统 API。边界清楚，才不会把 prompt、业务逻辑和系统调用搅成一锅。

### 5. Browser 不重写

浏览器自动化应该复用成熟的 browser harness。

computer-use-harness 只负责把 browser capability 接进统一 Target / Observation / Action / Trace 协议，而不是重新发明一个 Playwright。

## Quick Start

### 1. 安装依赖

```sh
npm install
```

### 2. 构建 CLI

```sh
npm run build
```

### 3. 跑 fake use case

```sh
./dist/cli/index.js usecases list
./dist/cli/index.js usecases run UC-030 --fake
./dist/cli/index.js trace --last
```

### 4. 构建 Swift helper

```sh
cd native/mac-helper
swift build
```

### 5. 跑 native helper smoke

```sh
./dist/cli/index.js usecases run UC-030 \
  --mac-helper ./native/mac-helper/.build/debug/computer-use-mac-helper
```

预期结果：

- CLI 返回 `ok: true`。
- run status 可能是 `failed`。
- trace 中会出现 native helper 返回的稳定失败码。
- 不会执行真实点击或输入。

## CLI

所有命令默认输出 JSON。

```sh
computer-use version
computer-use apps
computer-use capabilities --app Safari
computer-use usecases list
computer-use usecases dry-run UC-030
computer-use usecases run UC-030 --fake
computer-use usecases run UC-030 --mac-helper ./native/mac-helper/.build/debug/computer-use-mac-helper
computer-use trace --last
```

人类可读格式使用：

```sh
--pretty
```

CLI 约束：

- stdout 只输出结构化结果。
- 业务失败也返回 JSON。
- 日志和非协议噪声不能污染 stdout。
- error code 必须稳定。
- action failure 必须进入 trace。

## 任务拆解

项目按 use case 向下拆，而不是按文件或类名拆。

顶层 use cases 放在：

```text
usecases/cases.yaml
```

初始任务分层：

| Task | 目标 | 当前状态 |
|---|---|---|
| Task 1 | Use case harness | Done |
| Task 2 | CLI skeleton | Done |
| Task 3 | Core contracts | Done |
| Task 4 | Trace runtime | Done |
| Task 5 | Policy guard | Done |
| Task 6 | App capability registry | Done |
| Task 7 | Mac helper protocol | Done |
| Task 8 | Mac helper minimal implementation | In progress |
| Task 9 | Real Mac actions | Not started |
| Task 10 | Browser harness adapter | Not started |
| Task 11 | Agent skills | Not started |

拆分原则：

- 先写用户场景，再写实现任务。
- 每个 task 必须有成功和失败信号。
- 真实 action 必须在 policy 和 trace 之后。
- native helper 只暴露稳定协议，不暴露 AXUIElement 内部细节。
- browser capability 接 adapter，不和 mac helper 混在一起。

详细任务见 [`ROADMAP.md`](./ROADMAP.md)。

## Agent 定义

computer-use-harness 面向多个调用者，但 runtime 行为必须一致。

### 1. Human Operator

人类开发者直接通过 CLI 调试本机能力。

职责：

- 授权 macOS 权限。
- 运行 smoke use case。
- 查看 trace。
- 判断真实 action 是否可以进入下一阶段。

### 2. Coding Agent

Claude Code、Codex 这类 coding agent 通过 shell 调 CLI。

职责：

- 调 `usecases dry-run` 理解能力边界。
- 调 `apps/capabilities` 选择 adapter。
- 读取 JSON result，不解析自然语言。
- 遇到 policy blocked 时停止动作，不绕过 runtime。

### 3. Computer-Use Runner

执行具体 action 的 runtime 角色。

职责：

- 接收 Target / Action。
- 调 policy guard。
- 选择 adapter。
- 调 native helper 或 browser harness。
- 写 trace。
- 返回 ActionResult。

### 4. Policy Guard

动作前置裁判。

职责：

- 阻止受保护目标。
- 标记 confirm-required action。
- 保持 blocked rule 可审查。
- 把 decision 写入 trace。

### 5. Native Helper

Swift sidecar binary。

职责：

- 检查 macOS 权限。
- 枚举 app 和窗口。
- 读取基础 app state。
- 执行或拒绝 native action。
- 返回稳定 JSON-RPC result/error。

### 6. Browser Adapter

浏览器能力接入层。

职责：

- 复用已有 browser-harness。
- 把 DOM/browser state 映射成 Observation。
- 把 browser click/type/navigate 映射成 ActionResult。
- 不直接依赖 Mac helper。

## 项目结构

```text
computer-use-harness/
├── src/
│   ├── cli/              # CLI entry and JSON output
│   ├── core/             # stable contracts and errors
│   ├── runtime/          # trace, policy, app capability registry
│   ├── adapters/mac/     # TS helper protocol and clients
│   └── usecases/         # fake/native runners and planning
├── native/mac-helper/    # Swift stdio JSON-RPC helper
├── usecases/             # end-to-end use case contracts
├── docs/engineering/     # engineering notes
└── ROADMAP.md
```

## 当前边界

已经完成的是执行系统的骨架，不是“全自动控制 Mac”的成品。

下一阶段会进入高风险区：

- element ref 解析。
- element 过期错误。
- click by element ref。
- type text。
- press key。
- scroll。
- screenshot fallback。

这些能力必须逐个接入，逐个验收。不能为了 demo 一次性打开。

## Development

```sh
npm run format
npm run check
npm run typecheck
npm run build
cd native/mac-helper && swift build
```

## Status

Public, early-stage, protocol-first.

适合读源码、提 issue、讨论架构，也适合拿去做自己的 agent computer-use runtime 起点。
