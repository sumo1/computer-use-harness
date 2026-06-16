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
- 自由 native action runner（observe / open / click / type / key / scroll / drag / hover / extract）。
- fake runner。
- JSONL trace runtime。
- policy guard。
- app capability registry。
- TS / Swift helper protocol。
- Swift native helper 实现。
- native helper stdio JSON-RPC 长连接。
- native runner，默认自动发现 Swift helper，也可通过 `--mac-helper <path>` 覆盖，把真实 action 执行结果写入 trace。

当前 Swift helper 支持：

- `permissionStatus`
- `listApps`
- `listWindows`
- `getAppState`
- `open` - 启动 app 或打开文件
- `click` - 点击 AX 元素或屏幕坐标
- `type` - 输入文本（标准 AX 输入或 paste fallback）
- `key` - 按键和快捷键
- `scroll` - 滚动并重新观察
- `drag` / `hover` / `secondary-click` - 基础鼠标操作

两条入口并存：

- `computer-use usecases run ...`：跑 `usecases/cases.yaml` 里的预定义回归用例。
- `computer-use observe/click/type/key/scroll/...`：给 agent 或 shell loop 做一步一决策的通用原子操作，不需要先写 case。

**真实 usecase 已验证**：

- **UC-100**: QQ Music 搜索"鸭子"并播放
- **UC-110**: Sublime Text 编辑文件并保存，含文件系统验证

两个 usecase 都包含完整 trace、policy decision、app-specific fallback 和外部验证证据。

## 任务沉淀

当前活跃任务和双契约入口放在 [`docs/task/260603-multi-app-close-loop/`](./docs/task/260603-multi-app-close-loop/).

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

### 2. 构建并安装 CLI

```sh
npm run build
npm install -g .
```

### 3. 跑 fake use case

```sh
computer-use usecases list
computer-use usecases run UC-030 --fake
computer-use trace --last
```

### 4. 跑自由原子 action

```sh
computer-use observe --app "Fake Target App" --fake --pretty
computer-use click --app "Fake Target App" --fake \
  --keyword Primary \
  --description "click button named Primary" \
  --pretty
computer-use scroll --app "Fake Target App" --fake --direction down --amount 2 --pretty
```

每个 action 都会执行 policy、必要的 observe-before、action、observe-after，并写入 trace。
result trace event 会附加 `actionTraceStep`，用于审计这一轮闭环：

- `before` / `after`：动作前后的 observation。
- `execution.inputBackend`：真实输入后端，取值为 `ax-semantic`、`app-targeted-event` 或 `global-hid`。
- `verification`：动作后观察是否完成、是否命中目标状态。
- `virtualPointer`：harness 推断的指向位置，不是第二个系统鼠标。
- `virtualPointerOverlay`：当 observation 带 screenshot 时生成的 SVG 指针 overlay。

### 5. 构建 Swift helper

```sh
cd native/mac-helper
swift build
```

### 6. 跑真实 usecase

```sh
# QQ Music: 搜索"鸭子"并播放
computer-use usecases run UC-100

# Sublime Text: 编辑并保存文件
computer-use usecases run UC-110

# 查看 trace
computer-use trace --last
```

预期结果：

- CLI 返回 `ok: true`。
- run status 为 `passed`（如果 app 已安装且有权限）。
- trace 包含完整的 observation / action / policy / result 事件，以及 result event 上的 `actionTraceStep`。
- UC-110 会在 `/tmp/computer-use-harness/uc-110.txt` 留下真实文件。

## CLI

所有命令默认输出 JSON。

```sh
computer-use version
computer-use apps
computer-use apps --running
computer-use doctor --app Finder
computer-use doctor --pid 12345
computer-use resolve-app --app Finder
computer-use resolve-app --pid 12345
computer-use resolve-app --window-title "Downloads"
computer-use capabilities --app Safari
computer-use observe --app Finder --summary --text
computer-use observe --pid 12345 --summary --text
computer-use text --app Finder
computer-use screenshot --app Finder --out /tmp/finder.png
computer-use click --app Finder --keyword Downloads --description "click item named Downloads"
computer-use type --app "Fake Target App" --fake --keyword "Main Input" --text hello
computer-use type --pid 12345 --x 750 --y 498 --text 888888
computer-use key --app Finder --key Enter
computer-use key --pid 12345 --key 8
computer-use scroll --app Finder --direction down --amount 2
computer-use extract --app Finder --query "visible files" --fields files
computer-use usecases list --cases ./usecases/cases.yaml
computer-use usecases dry-run UC-030
computer-use usecases run UC-030 --fake
computer-use usecases run UC-030
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
- agent shell 脚本必须同时检查 `ok` 和 `data.status`；需要让 shell 在动作失败时非 0，可加 `--fail-on-action-failed`。
- `apps` 默认是 capability registry，不是运行中进程列表；运行中 app 用 `apps --running`。
- real macOS 命令默认按顺序找 helper：`--mac-helper`、`COMPUTER_USE_MAC_HELPER`、`COMPUTER_USE_HARNESS_DIR`、当前 repo 默认 build path。
- 多个同名 Electron/候选客户端同时运行时，优先用 `--pid` 或 `--window-title` 精确定位；`--app` 适合唯一 app 名或 bundle id。
- 无名/分格输入框可先 `click --x --y` 聚焦，再用 `type --x --y --text ...` 或 `key --key 8` 这类原子动作输入。
- 跨仓库调用 use case 时传 `--cases <path>`，避免依赖当前工作目录。
