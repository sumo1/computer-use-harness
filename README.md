# computer-use-harness

一个 Mac 优先的 CLI computer-use harness。

## 当前对齐

这个项目先不做外部 server，也不做独立桌面 App。

第一阶段产品形态是 CLI：

- 面向 Mac。
- 从 Claude Code、终端、脚本或 MCP 调用。
- 提供操作其他 App 的能力。
- 提供截图、读取 UI 结构、模拟点击、输入、快捷键、滚动等能力。
- 应用层、协议层、工具调度优先用 TypeScript。
- 贴近 macOS 底层的能力，通过 native bridge 暴露给 TS。

## TS 适合写这个 CLI 吗

结论：**适合，而且比桌面 App 更适合第一版。**

TS 很适合写这些部分：

- agent loop 和任务状态机。
- provider 适配，比如 OpenAI / Anthropic / local model。
- browser adapter，直接集成本地 `browser-harness` 服务。
- 日志、配置、插件、MCP/tool 调度。
- CLI 命令、JSON 输入输出、trace 文件。
- 和 Claude Code 这类终端工具集成。

TS 不适合单独硬写这些部分：

- macOS Accessibility API。
- ScreenCaptureKit。
- CGEvent 鼠标键盘注入。
- App 权限检测和系统授权引导。
- 深度窗口管理、进程管理、剪贴板边界、安全沙箱。

这些应该放在 native 层，用 Swift / Rust / Objective-C 封装成稳定 API，再给 TS 调。

## 技术路线判断

### 路线 A: Node.js CLI + TypeScript

适合快速启动。

优点：

- TS/Node 生态最顺。
- 做 CLI、LLM 调用、本地文件、插件、MCP、浏览器自动化都方便。
- 和 Claude Code 这类终端工具集成最自然。
- 不需要维护桌面 UI、窗口、托盘、自动更新这些额外产品面。
- native 能力可以通过 Node native addon、sidecar binary 或 Swift helper 接入。

缺点：

- 没有 GUI 权限引导，首次授权体验要靠命令行说明和检测。
- Mac TCC 权限可能授给 Terminal/iTerm，也可能授给 CLI binary/helper，分发方式要设计清楚。
- 深度 macOS 能力仍然需要 native bridge。

### 路线 B: Rust/Swift CLI + TS 包装层

适合底层能力优先。

优点：

- macOS API 接入更直接。
- 二进制分发更清楚。
- 权限、签名、系统调用边界更硬。

缺点：

- agent loop、provider、MCP、插件生态没有 TS 顺。
- 如果团队主要是 TS，早期迭代速度会下降。
- 容易过早陷入 native 工程。

## 第一版建议

先用 **Node.js CLI + TypeScript + Swift native helper**。

理由很现实：

1. 目标用户就在终端里，CLI 是最短路径。
2. Claude Code 可以直接通过命令、MCP 或本地 stdio 调用。
3. TS 能覆盖 agent loop、工具编排、模型接入、trace，并把浏览器能力路由到本地 `browser-harness`。
4. macOS 底层能力单独做 native helper，边界清楚。
5. 不引入桌面 App UI，就不会被窗口、托盘、菜单、自动更新拖住。

坏味道要避开：不要把 Swift 系统调用、TS 业务逻辑、模型 prompt、CLI 输出混在一个文件里。TS 可以做编排，但 macOS capability 必须是独立模块。

## CLI 还是 Skill

结论：**核心先做 CLI runtime。Claude Code / Codex 先通过 skill 直接调用 CLI；MCP 作为后续增强，不进入第一版必做范围。**

不要只做 skill。

原因：

- skill 本质是 `SKILL.md` + 说明 + 可选脚本，适合告诉 agent 什么时候用、怎么用。
- native 权限、macOS helper、签名、Accessibility、ScreenCaptureKit、trace、policy guard 不适合塞进 skill。
- 只做 skill 会绑定某个 agent 的加载机制，难以同时服务 Claude Code、Codex、终端脚本和未来 IDE。
- CLI 可以独立测试、独立发布、独立升级；skill 只是调用它。

推荐形态：

```text
computer-use CLI
  真正能力：doctor / apps / app-state / click / type / trace

computer-use mcp
  后续增强：同一个 binary 的 stdio MCP 模式，不是另起一个外部 server

Claude Code Skill
  SKILL.md：告诉 Claude 何时直接调用 computer-use CLI，如何读 JSON，哪些动作要确认

Codex Skill / Plugin
  同样是薄包装，复用同一个 CLI/MCP runtime
```

也就是说：

```text
Runtime SSOT = CLI/MCP
Agent-specific UX = Skill
```

MCP 不是第一版必需。Claude Code 可以直接通过 shell 调 CLI，所以第一版只要把 CLI 做扎实。

CLI 够用的场景：

- 人类调试。
- shell 脚本。
- smoke test。
- Claude Code / Codex 通过 skill 直接调用命令。

MCP 更适合的场景：

- Claude Code / Codex 稳定集成。
- tool schema 明确，不靠 shell 字符串拼接。
- session 可以在一个 MCP 进程里保活。
- 错误、artifact、trace metadata 可以结构化返回。
- 参数校验和权限确认更好做。

所以顺序是：

```text
1. 先实现 CLI primitives
2. 写 Claude Code / Codex skill 调 CLI
3. 用真实任务验证 JSON 输出、exit code、trace
4. 再决定是否加 computer-use mcp 薄封装
```

为了让 CLI 被 agent 稳定调用，第一版必须保证：

- 默认输出机器可读 JSON。
- human readable 输出必须显式 `--pretty`。
- stdout 只输出结果，日志走 stderr 或 trace 文件。
- exit code 稳定。
- error code 稳定。
- 所有动作返回 `ActionResult`，不要只返回一段自然语言。

skill 可以附带脚本，但脚本只应该做轻封装：

```text
scripts/app-state.sh -> computer-use app-state "$@"
scripts/doctor.sh    -> computer-use doctor "$@"
```

不要让 skill 自己实现点击、截图、权限检测。那会变成多份实现，后面必烂。

## CLI 工程结构

第一版工程结构建议：

```text
computer-use-harness/
├─ package.json
├─ tsconfig.json
├─ src/
│  ├─ cli/
│  │  ├─ index.ts
│  │  └─ commands/
│  │     ├─ doctor.ts
│  │     ├─ apps.ts
│  │     ├─ app-state.ts
│  │     ├─ action.ts
│  │     ├─ browser.ts
│  │     └─ trace.ts
│  │
│  ├─ mcp/
│  │  ├─ server.ts
│  │  └─ tools.ts
│  │
│  ├─ core/
│  │  ├─ contracts.ts
│  │  ├─ errors.ts
│  │  ├─ json.ts
│  │  └─ result.ts
│  │
│  ├─ runtime/
│  │  ├─ config.ts
│  │  ├─ session.ts
│  │  ├─ policy.ts
│  │  ├─ trace.ts
│  │  └─ app-registry.ts
│  │
│  ├─ adapters/
│  │  ├─ mac/
│  │  │  ├─ mac-adapter.ts
│  │  │  └─ mac-helper-client.ts
│  │  ├─ browser-harness/
│  │  │  └─ browser-harness-adapter.ts
│  │  └─ apps/
│  │     ├─ jetbrains.ts
│  │     └─ finder.ts
│  │
│  └─ skills/
│     ├─ claude-code/
│     └─ codex/
│
├─ native/
│  └─ mac-helper/
│     ├─ Package.swift
│     └─ Sources/
│        └─ ComputerUseMacHelper/
│           ├─ main.swift
│           ├─ Accessibility/
│           ├─ ScreenCapture/
│           ├─ Input/
│           └─ Apps/
│
└─ tests/
   ├─ unit/
   ├─ contract/
   └─ fixtures/
```

不要一开始拆更多。`src/mcp` 可以先不建，等 CLI primitives 跑通后再说。

### 分层职责

#### `src/cli`

只负责命令行入口：

- 参数解析。
- JSON / pretty 输出。
- exit code。
- 调用 `runtime`。

CLI 层不要直接调用 macOS API，也不要直接知道 browser-harness 协议。

#### `src/mcp`

只负责把同一套 runtime 暴露成 MCP tools。

MCP 不应该复制 CLI 逻辑。正确关系是：

```text
CLI command -> runtime
MCP tool    -> runtime
```

#### `src/core`

纯类型和协议层，不依赖 Node、不依赖 macOS、不依赖 browser-harness。

这里放：

- `Target`
- `Observation`
- `ElementRef`
- `Action`
- `ActionResult`
- `AppCapability`
- `TraceEvent`
- 错误类型

这是整个项目的地基。这里如果混进具体实现，后面扩展会很痛。

#### `src/runtime`

编排层。

职责：

- session 生命周期：`start/end`
- app capability registry
- policy guard
- trace 写入
- adapter 路由
- config 读取

这里决定“这次操作应该走 browser-harness、JetBrains adapter、Mac AX，还是 screen fallback”。

#### `src/adapters`

能力实现层。

第一版至少三类：

```text
browser-harness
  调本地 browser-harness 服务

mac
  调 Swift helper，提供 list-apps / app-state / click / type / screenshot

apps
  App-specific adapter，比如 JetBrains、Finder
```

App-specific adapter 只处理这个 App 的特殊能力，不要污染 runtime。

#### `native/mac-helper`

Swift helper 独立进程，和 TS CLI 通过 JSON-RPC over stdio 通信。

第一版不建议做 Node native addon。

原因：

- Swift 直接调用 macOS API 更自然。
- 独立 binary 更容易签名、授权、debug。
- Node addon 会引入 N-API、构建链、架构兼容这些不必要复杂度。

helper 暴露小接口：

```text
listApps
listWindows
getAppState
screenshot
click
type
setValue
key
scroll
drag
permissionStatus
openPermissionPane
```

当前 Swift helper 已实现 `permissionStatus`、`listApps`、`listWindows`、`getAppState`，并为 `click/type/key/scroll` 提供请求校验和稳定 `ActionResult` 失败返回。真实 UI 动作执行仍然关闭。

TS 侧已有 stdio client，可复用 helper 进程并区分 JSON-RPC 错误和 `ActionResult` 动作失败。

CLI 已提供显式 native runner 入口：

```sh
computer-use usecases run UC-030 --mac-helper ./native/mac-helper/.build/debug/computer-use-mac-helper
```

该入口当前只用于验证 native helper 协议和 trace 写入；真实 UI 动作仍由 helper 返回 `UNIMPLEMENTED` 或稳定失败码。

### 数据流

```text
Claude Code
  -> MCP tool / CLI command
  -> runtime
  -> policy guard
  -> app capability registry
  -> adapter
  -> native helper / browser-harness
  -> ActionResult
  -> trace
  -> JSON output
```

### 配置目录

```text
~/.computer-use/
├─ config.json
├─ approvals.json
├─ app-registry.json
├─ traces/
└─ logs/
```

### 测试策略

第一版测试不要上来追求 UI 自动化全覆盖。

先做三类：

- unit：policy、registry、command parsing。
- contract：fake adapter 验证 `Observation / ActionResult` 协议。
- smoke：本机 Mac 上手动/半自动跑 `doctor/list-apps/app-state`。

真正的 GUI integration test 后面再加。先把协议和边界打稳。

## Mac 能力边界

第一版只考虑 Mac，需要的系统能力大概是：

```text
Claude Code / Terminal
  |
  |-- TS Application Layer
  |     |-- CLI command
  |     |-- MCP tools
  |     |-- agent loop
  |     |-- model provider
  |     |-- task/session/trace
  |     |-- browser-harness adapter
  |
  |-- Native Mac Bridge
        |-- Accessibility API: 读取和操作其他 App UI 元素
        |-- ScreenCaptureKit: 截图/屏幕流
        |-- CGEvent: 鼠标键盘输入
        |-- NSWorkspace: App/窗口/进程信息
        |-- Clipboard / AppleScript / URL Scheme: 对支持自动化的 App 走更高层通道
```

原则：

- 能用 App 自己的 automation API，就不要模拟鼠标。
- 能用 Accessibility Tree，就不要纯看截图。
- 截图是兜底，不是唯一状态源。
- native bridge 只暴露小而稳定的 API，TS 层不要知道 AXUIElement 细节。

## 最小架构

先收敛成五块：

```text
CLI
  命令入口，支持人类调用、Claude Code 调用、JSON 输出

Agent Runtime
  TS 写任务循环：observe -> decide -> act -> verify

Mac Bridge
  native 封装截图、AX tree、点击、输入、窗口状态

Adapters
  browser-harness / generic app / app-specific shortcuts

Trace
  记录每一步 observation、action、result，方便回放和 debug
```

这就够了。现在不需要提前拆一堆目录。

## App 能力分层

本地 App 操作要分层，不要所有 App 都走同一套截图点击。

第一版按能力从强到弱分 5 层：

```text
L0 Blocked
  明确禁止操作，比如当前终端、Claude Code/Codex 自身、系统安全弹窗、密码输入框。

L1 Custom Adapter
  对特定 App 有定制能力，比如 browser-harness、Finder adapter、Xcode adapter。

L2 App Automation
  App 自己支持 AppleScript、URL Scheme、Shortcuts、CLI、MCP，就优先走这些结构化通道。

L3 Accessibility Generic
  使用 macOS Accessibility Tree 读取元素、点击、设置值、执行 action。

L4 Screen Fallback
  只剩截图、OCR、坐标点击、键盘输入。能不用就不用。
```

调用顺序固定：

```text
resolve app
  -> check policy
  -> find custom adapter
  -> find app automation
  -> fallback to AX generic
  -> fallback to screen
```

这能把特殊情况关在 adapter 里，不让 agent runtime 变成 if/else 垃圾堆。

## App Capability Registry

需要一个本地 registry，声明每个 App 当前支持什么能力。

示例：

```json
{
  "bundleId": "com.apple.Safari",
  "name": "Safari",
  "support": "custom",
  "adapter": "browser-harness",
  "capabilities": [
    "observe.dom",
    "observe.screenshot",
    "act.click",
    "act.type",
    "act.navigate",
    "verify.url",
    "verify.text"
  ],
  "fallback": ["accessibility", "screen"],
  "risk": "normal"
}
```

另一个普通 App：

```json
{
  "bundleId": "com.apple.Notes",
  "name": "Notes",
  "support": "generic",
  "adapter": "mac-accessibility",
  "capabilities": [
    "observe.axTree",
    "observe.screenshot",
    "act.click",
    "act.type",
    "act.key",
    "act.scroll"
  ],
  "fallback": ["screen"],
  "risk": "normal"
}
```

明确禁止的 App：

```json
{
  "bundleId": "com.apple.Terminal",
  "name": "Terminal",
  "support": "blocked",
  "reason": "do-not-automate-current-execution-environment"
}
```

## Capability 可见性

CLI 要能告诉调用方哪些 App 支持定制能力，哪些只支持通用能力。

```text
computer-use apps
computer-use apps --json
computer-use capabilities --app Safari
computer-use capabilities --app Notes
```

输出里必须包含：

- App 名称
- bundle id
- support level: `blocked | custom | automation | generic | screen`
- adapter 名称
- 支持的 observe/action/verify 能力
- fallback 路径
- 是否需要授权
- 风险等级

Claude Code 调用前应该先查 capability，而不是直接猜能不能点。

## JetBrains / IDEA 这类 IDE

IDEA 可以使用 Accessibility Tree，但不应该只依赖通用 AX。

JetBrains IDE 官方支持 macOS VoiceOver 和 Windows screen readers，说明按钮、菜单、设置面板、工具窗口等 UI 有基础 accessibility 支持。第一版可以把 IDEA 设成：

```json
{
  "bundleId": "com.jetbrains.intellij",
  "name": "IntelliJ IDEA",
  "support": "automation",
  "adapter": "jetbrains-ide",
  "capabilities": [
    "observe.axTree",
    "observe.screenshot",
    "act.click",
    "act.type",
    "act.key",
    "act.scroll",
    "act.menu",
    "automation.shortcuts"
  ],
  "fallback": ["accessibility", "screen"],
  "risk": "normal"
}
```

建议分三层：

```text
L1 JetBrains-specific
  用 IDE 自己的快捷键、命令、配置文件、插件或命令行能力。

L2 Accessibility Generic
  用 AX tree 操作设置弹窗、按钮、菜单、工具窗口、输入框。

L3 Screen Fallback
  UI 树缺失时才用截图/OCR/坐标。
```

对 IDEA 来说，适合 AX 的场景：

- 打开设置。
- 找按钮。
- 点菜单。
- 操作弹窗。
- 在搜索框、设置项、普通输入框里输入。
- 切换工具窗口。

不适合只靠 AX 的场景：

- 大段代码编辑。
- 精确选择 editor 内某个语法节点。
- 根据代码语义做重构。
- 控制复杂自绘 editor 组件。

这些应该优先走 IDE 能力：快捷键、command palette、JetBrains plugin、项目文件修改、命令行构建/测试，而不是让 computer-use 去模拟一个程序员手点 IDE。

## 第一批 CLI 命令

先别做完整 agent，先把可用的底层能力打穿：

```text
computer-use list-apps
computer-use apps --json
computer-use capabilities --app "Safari"
computer-use start --app "Safari"
computer-use list-windows --app "Safari"
computer-use app-state --app "Safari" --screenshot false
computer-use screenshot --app "Safari"
computer-use click --app "Safari" --ref <element-ref>
computer-use type --text "hello"
computer-use key --combo "cmd+l"
computer-use scroll --direction down
computer-use browser state
computer-use browser click --ref <element-ref>
computer-use end
computer-use trace --last
```

命令默认输出 JSON，方便 Claude Code 消费。人类可读输出可以后面加 `--pretty`。

## MVP 能力目标

第一版落地后，目标就是能完成这些基础动作：

```text
打开 App
  -> 找到窗口
  -> 读取 UI 结构
  -> 找到按钮/输入框
  -> 点击/输入
  -> 再读取状态验证是否成功
```

典型流程：

```text
computer-use open-app --app "Notes"
computer-use app-state --app "Notes" --screenshot false
computer-use find --app "Notes" --role button --name "New Note"
computer-use click --app "Notes" --ref <button-ref>
computer-use find --app "Notes" --role text-field
computer-use type --app "Notes" --ref <field-ref> --text "hello"
computer-use app-state --app "Notes" --screenshot false
```

能力判断：

- 如果 Accessibility Tree 能读到按钮/输入框，就用 role/name/value/bounds 找元素。
- 如果元素支持 set value，就优先 `set-value`。
- 如果不支持 set value，就 click 后模拟键盘输入。
- 如果 Accessibility Tree 不完整，再退回 screenshot/OCR/坐标点击。
- 每次动作后都要刷新 app state，不能复用旧 element ref。

不能承诺稳定的场景：

- canvas/WebGL/游戏类界面。
- 自绘 UI 很重的 App。
- Accessibility 信息缺失或命名混乱的控件。
- 密码框、管理员弹窗、系统安全授权弹窗。
- 当前终端、Claude Code/Codex 自身。

这些不是不能碰，而是默认不应该当成第一版稳定能力。

## Mac 权限问题

CLI 不是免权限通道。

第一版必须处理：

- Accessibility 权限。
- Screen Recording 权限。
- 输入模拟权限。
- 终端 App 和 native helper 的授权归属。

这里最容易踩坑：用户以为授权给了 CLI，实际上系统可能要求授权给 Terminal、iTerm、VS Code，或者签名后的 helper binary。这个问题要在安装和自检命令里明确检测。

## 从 Codex Computer Use 借鉴什么

Codex 的方案有几个点值得直接借。

### 1. 系统权限和 App 授权分开

Codex 在 macOS 上需要 Screen Recording 和 Accessibility 系统权限，同时还有 Codex 自己的 App 级授权：允许它操作哪些 App。

我们也应该分两层：

```text
OS permission
  这个 CLI/helper 有没有能力看屏幕、点鼠标、读 AX tree

Target approval
  这次任务是否允许操作 Safari、Xcode、Finder、Slack
```

不要把“系统给了 Accessibility 权限”理解成“所有 App 都可以随便动”。这是权限设计里的烂味道。

### 2. 默认按目标 App 收口

Codex 要求用户明确说 `@Computer` 或 `@AppName`，并描述具体 App、窗口或流程。

我们的 CLI 也应该这样：

```text
computer-use app-state --app Safari
computer-use click --app Safari --ref ...
computer-use run --app Xcode --task "open build settings and inspect signing"
```

第一版不要做“全屏自由漫游”。范围越大，失败越难 debug，风险也越大。

### 3. 有结构化能力就不用 computer use

Codex 文档明确建议：如果目标 App 有专用 plugin 或 MCP server，优先用结构化集成；computer use 只在需要视觉检查或 GUI 操作时使用。

我们也要坚持：

```text
app-specific API / MCP
  > browser adapter
  > accessibility tree
  > screenshot + coordinate
```

computer use 是补洞能力，不是万能入口。

### 4. Browser 单独做，不塞进 Generic App

Codex 把 in-app browser / browser use / Chrome extension 和通用 computer use 分开。

这点非常对。浏览器有 DOM、network、console、storage、download、extension、profile，这些都不是普通桌面 App 的问题。

我们已有本地 `browser-harness` 服务，所以这里不要重写浏览器自动化。CLI 只做一层 adapter：

```text
computer-use browser ...
  -> local browser-harness service

computer-use app ...
  -> Mac native bridge
```

不要让浏览器退化成“另一个可以点的窗口”。

这个 adapter 的职责应该很薄：

- 发现/连接本地 `browser-harness`。
- 把浏览器 observation 转成统一 JSON 输出。
- 把 click/type/navigate 等命令转发给 `browser-harness`。
- 把结果写入本项目的 trace。
- 复用本项目的 policy guard，比如外部站点、上传、提交表单、敏感数据传输。

它不应该重新实现 Playwright/CDP。

### 5. 敏感动作必须二次确认

Codex 的本地 Computer Use skill 里有很细的确认策略：删除、付款、发消息、上传文件、保存密码、改系统设置、传输敏感数据等都需要确认。

CLI 版本也要内置 action policy：

```text
allowed       普通观察、截图、读状态
confirm       删除、提交表单、上传、发消息、改设置
blocked       绕过安全警告、批准系统权限、自我自动化
```

不要把这些逻辑写进 prompt。prompt 是建议，policy 才是边界。

### 6. 不自动化终端和自己

Codex 明确说 computer use 不能自动化 terminal apps 或 Codex 自身，因为这会绕过安全策略。

我们也应该默认禁止：

- 操作当前运行 `computer-use` 的终端。
- 操作 Claude Code / Codex 自身。
- 自动批准系统安全弹窗。
- 自动输入管理员密码。

这条很重要。否则 agent 可以通过 UI 绕过 CLI 的权限边界。

### 7. Windows 和 Mac 行为不同

Codex 文档里 Windows computer use 是前台接管，macOS 可以做 scoped background task，甚至有 locked use。

我们的第一版先 Mac，不要提前承诺 Windows 后台能力。跨平台接口可以留，但行为语义要诚实：

```text
macOS: 可能支持后台/指定 App 操作
Windows: 更可能是前台 takeover 或 VM 内操作
```

## 对我们方案的直接调整

第一版 CLI 增加这些概念：

```text
computer-use doctor
  检查 Screen Recording / Accessibility / helper 签名 / 终端授权归属

computer-use allow-app Safari
computer-use deny-app Slack
computer-use approvals list
  管理 per-app allowlist

computer-use app-state --app Safari
  只观察被授权 App

computer-use click --app Safari --ref <ref>
  动作前过 policy guard

computer-use run --app Safari --task "..."
  高层任务也必须绑定目标 App
```

数据上先加三个文件就够：

```text
~/.computer-use/config.json
~/.computer-use/approvals.json
~/.computer-use/traces/<run-id>.jsonl
```

这比做一个 App 设置页粗糙，但可用，而且符合 CLI 产品形态。

## 和 Codex 内置 Computer Use 的差别

Codex 内置 Computer Use 的优势：

- 和 Codex App 深度集成。
- 有 App 级授权 UI。
- 有系统权限引导。
- 有内置确认策略。
- 能在 Codex 会话里直接被 agent 调用。
- browser / computer use / Chrome extension 等产品边界已经打通。

我们不应该复制这些产品层能力。

我们的定位是：

```text
Codex Computer Use
  Codex 产品内置能力

computer-use-harness
  agent-agnostic CLI runtime
```

差别：

| 维度 | Codex 内置 Computer Use | computer-use-harness |
|---|---|---|
| 入口 | Codex App 内部 tool | CLI / shell / skill / 后续 MCP |
| 使用对象 | 主要服务 Codex | Claude Code、Codex、普通 shell、脚本 |
| 权限体验 | App UI 引导和审批 | CLI doctor + approvals config |
| 浏览器 | Codex in-app browser / Chrome extension | 本地 `browser-harness` adapter |
| App 能力 | 通用 computer use 为主 | 显式 App capability registry |
| 扩展方式 | Codex 插件/工具体系 | CLI adapter / skill / app-specific automation |
| 输出 | 面向 Codex 会话 | 稳定 JSON / trace / exit code |
| 可脚本化 | 弱一些 | 强 |
| 产品 UI | 强 | 第一版不做 |

## 我们能额外实现什么

### 1. Agent-agnostic

同一个工具可以被这些入口调用：

```text
Claude Code
Codex
普通终端
shell 脚本
未来 MCP client
```

这点是核心差异。不要把能力绑死在某个 agent 产品里。

### 2. App Capability Registry

我们可以明确告诉调用方：

```text
Safari: custom via browser-harness
IntelliJ IDEA: automation + AX fallback
Notes: generic AX
Terminal: blocked
Unknown App: screen fallback only
```

Codex 内置能力更像通用工具，我们可以做得更“工程化”：先声明能力，再调用能力。

### 3. App-specific Adapter

对常见 App 做定制：

- JetBrains / IDEA：快捷键、命令、AX、插件能力。
- Finder：文件选择、窗口、路径。
- Xcode：build/test/signing 面板。
- Browser：走本地 browser-harness。

通用 computer use 不适合把这些特殊知识全塞进去。我们可以用 adapter registry 管住它。

### 4. 稳定 JSON 和可脚本化

所有命令默认输出：

```json
{
  "ok": true,
  "action": "click",
  "target": {...},
  "snapshot": {...},
  "traceId": "..."
}
```

这样 Claude Code 可以直接读，shell 也可以直接管道处理。

### 5. Trace / Replay 面向工程调试

我们可以把每一步落到：

```text
~/.computer-use/traces/<run-id>.jsonl
```

包括：

- observation
- element refs
- action
- result
- screenshot path
- error code
- policy decision

这比“会话里看一下失败了”更适合调试工具本身。

### 6. 更强的 fallback 透明度

每次动作都应该告诉调用方走了哪一层：

```text
custom-adapter
app-automation
accessibility
screen-fallback
```

这样失败时知道问题在哪，不会把所有失败都甩给模型。

## 我们比 Codex 弱的地方

第一版会弱于 Codex 的地方也要承认：

- 没有成熟的 App 授权 UI。
- 没有 Codex 内置的安全确认体验。
- 没有 locked/background use 这类产品能力。
- 没有完整 Windows 路径。
- 安全策略要自己补齐。

所以第一版不要试图“替代 Codex Computer Use”。更现实的目标是：

```text
给 Claude Code / Codex / shell 提供一个可脚本化、可扩展、可调试的本地 App 操作 runtime。
```

## GitHub 参考项目

这些项目值得拆开看，不是照抄。

### OpenBridge

- [AFK-surf/OpenBridge](https://github.com/AFK-surf/OpenBridge)  
  macOS-first local agent app，包含 Computer Use、skills、sandbox VM、native bridge、WebView bridge。

对我们有参考价值：

- `computer_use` 明确有 `start` / `end` 会话生命周期。
- `start` 时要求用户批准，并带 `apps` 范围。
- 启动时生成 running apps/window inventory，帮助 agent 选择 app、bundle id、window title。
- 每轮使用前先 `get-app-state`，默认 `include_screenshot=false`，优先 Accessibility。
- `click/type/scroll` 优先用 `element_index`，坐标点击只是兜底。
- 明确提示 element indexes 在导航、滚动、布局变化后会过期。
- action result 带 snapshot metadata：snapshot id、app、bundle id、pid、window title、window id、screenshot path。
- 权限检查分 pane：accessibility、screen recording、input monitoring。
- 权限不足时不是静默失败，而是把缺失权限变成 permission card / live status。
- skills 采用 inventory + 按需读取 `SKILL.md`，避免 base prompt 过胖。
- sandbox VM 的 accept/reject diff 机制，对我们后续“危险文件操作”有参考意义。

不建议照搬：

- SwiftUI / Notch / WebView chat 这些是 OpenBridge 的产品形态，不适合我们的 CLI-first 目标。
- sandbox VM 很重，第一版 computer-use CLI 不应该引入。
- vendored agent runtime 不是重点，我们只需要工具协议和状态/权限边界。

### macOS / Accessibility

- [CursorTouch/MacOS-MCP](https://github.com/CursorTouch/MacOS-MCP)  
  macOS MCP server，覆盖键鼠、窗口管理、UI state capture、Accessibility Tree 元素提取、AppleScript。可借鉴：工具面设计、MCP 暴露方式、AX tree 如何给 agent 消费。

- [openclaw/Peekaboo](https://github.com/openclaw/Peekaboo)  
  macOS CLI + MCP，重点是截图、窗口列表、窗口移动/聚焦、多屏和权限文档。可借鉴：`doctor/permissions`、window targeting、截图 artifact 管理。

### Cross-platform Desktop

- [lahfir/agent-desktop](https://github.com/lahfir/agent-desktop)  
  面向 AI agent 的 desktop automation CLI，强调 accessibility tree、结构化 JSON、deterministic element refs，支持 macOS/Windows/Linux。可借鉴：CLI 命令形态、元素 ref、跨平台抽象。

- [xa11y](https://github.com/xa11y/xa11y)  
  Playwright-style desktop UI automation，底层对应 macOS AXUIElement、Windows UIA、Linux AT-SPI2。可借鉴：把桌面 UI 自动化做成类似 Playwright 的 API。

- [iFurySt/open-codex-computer-use](https://github.com/iFurySt/open-codex-computer-use)  
  Codex Computer Use 的开源替代，面向 Codex App/CLI、Claude Code、Gemini CLI 等。可借鉴：如何对齐 Codex computer-use 体验和 MCP 形态。

### Windows / UIA

- [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP)  
  Windows MCP server，使用原生 Windows UI 元素、应用控制、文件导航和 UI interaction。可借鉴：Windows 侧工具面和 UIA 语义。

- [shanselman/FlaUI-MCP](https://github.com/shanselman/FlaUI-MCP)  
  基于 FlaUI / Windows UI Automation 的 MCP server。可借鉴：Windows UIA3、控件树、窗口/app 自动化边界。

### Browser / Hybrid

- [browser-use/browser-harness](https://github.com/browser-use/browser-harness)  
  直接连真实 Chrome 的薄 CDP harness。我们已有本地 browser-harness 服务，这个方向和我们的 browser adapter 一致。

- [sh3ll3x3c/native-devtools-mcp](https://github.com/sh3ll3x3c/native-devtools-mcp)  
  MCP server，覆盖截图、OCR、点击、输入、文本查找、Chrome/Electron CDP、模板匹配，支持 macOS/Windows/Android。可借鉴：browser + desktop hybrid 工具如何共存。

## 从这些项目归纳的借鉴点

1. **CLI/MCP 是主流形态**  
   多数项目不是先做复杂桌面 App，而是先给 agent 一个可调用工具面。

2. **Accessibility Tree 是第一状态源**  
   截图很有用，但成熟项目都在争取 AX/UIA/AT-SPI 的结构化树。

3. **Element Ref 必须稳定**  
   不能让模型每次重新猜坐标。要有 ref/id/selector/bounds/capability。

4. **Browser 和 Desktop 不要混成一锅**  
   browser 走 CDP/DOM/network，desktop 走 AX/UIA/screenshot。上层统一，底层分开。

5. **权限和 doctor 命令很重要**  
   Mac 上 Screen Recording / Accessibility；Windows 上 UIA/UAC/权限边界。第一版就要检测。

6. **跨平台抽象可以留，但第一版别同时做三端**  
   先 Mac，把接口设计成未来可接 Windows UIA；不要一开始就被 Windows/Linux 测试矩阵拖死。

## 外部依据

- Codex Computer Use 在 macOS 上要求 Screen Recording 和 Accessibility 权限，并且还有 App 级审批、Always allow、敏感动作确认等机制：[Codex Computer Use](https://developers.openai.com/codex/app/computer-use)
- Codex in-app browser 把浏览器能力和通用桌面 computer use 分开，且建议登录态/扩展场景用真实浏览器或 Chrome extension：[Codex In-app browser](https://developers.openai.com/codex/app/browser)
- Codex CLI 和 IDE extension 都支持 MCP server，适合我们把 harness 暴露成本地 STDIO MCP：[Codex MCP](https://developers.openai.com/codex/mcp)
- Claude Code skills 是带 `SKILL.md` 的能力包，可包含参考文件、脚本和模板；适合作为调用 CLI/MCP 的薄包装：[Claude Code Skills](https://code.claude.com/docs/en/skills)
- Claude Code MCP 支持把本地工具通过 stdio 等方式接进 Claude Code；适合承载真正的 tool runtime：[Claude Code MCP](https://code.claude.com/docs/en/mcp)
- IntelliJ IDEA 官方文档说明它支持 Windows 和 macOS 的屏幕阅读器，也可以通过 `ide.support.screenreaders.enabled=true` 手动启用 screen reader support：[IntelliJ IDEA Accessibility](https://www.jetbrains.com/help/idea/accessibility.html)
- Apple 的 Accessibility API 用于让辅助应用与其他 macOS 应用通信和控制 UI 元素：[AXUIElement](https://developer.apple.com/documentation/applicationservices/axuielement_h)
- Apple 的 ScreenCaptureKit 用于 Mac App 捕获屏幕和窗口内容：[ScreenCaptureKit](https://developer.apple.com/documentation/ScreenCaptureKit)
