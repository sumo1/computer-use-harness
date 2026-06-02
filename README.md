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
