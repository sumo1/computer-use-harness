# TypeScript Engineering Guide

本文档定义 `computer-use-harness` 的通用 TypeScript 工程规范。

它参考 `medeo-market` 中已经验证过的工程习惯，但只保留通用规则，不复制业务结构。

## 核心判断

这个项目是 CLI-first runtime，不是 Web service，也不是桌面 App。

所以规范目标是：

- 默认机器可读。
- 错误语义稳定。
- 入口薄，核心纯。
- 依赖显式注入。
- 底层能力通过 adapter/helper 边界隔离。

## 工具链

统一使用 npm、TypeScript、Biome。

必备命令：

```sh
npm run check
npm run typecheck
npm run build
```

命令语义：

- `npm run check`：运行 Biome，检查格式、lint 和 import 组织。
- `npm run format`：自动修复 Biome 能修的格式问题。
- `npm run typecheck`：只做 TypeScript 类型检查，不产生构建产物。
- `npm run build`：编译到 `dist/`，并确保 CLI 入口可执行。

不要把 `check` 写成单纯 `tsc --noEmit`。`check` 是工程卫生入口，`typecheck` 才是类型入口。

## TypeScript 基线

项目使用：

- ESM。
- `module: NodeNext`。
- `moduleResolution: NodeNext`。
- `strict: true`。
- `target: ES2023`。
- `lib: ["ES2023"]`。
- 输出 declaration、declaration map 和 source map。

所有相对导入必须包含 `.js` 后缀，因为 NodeNext 的 ESM 运行时需要真实扩展名。

公共 API、跨模块 contract、adapter 边界必须有明确类型。不要让调用方靠猜对象结构。

## 代码风格

Biome 是唯一格式化来源。

规则：

- 2 空格缩进。
- 双引号。
- 不强制分号。
- 行宽 100。
- import 由 Biome 组织。

不要手调格式和 Biome 打架。工具不该成为审美辩论场。

## 分层规则

当前目录职责：

- `src/cli`：命令行参数、stdout/stderr、exit code。
- `src/core`：稳定 contract、result、error、基础类型。
- `src/usecases`：端到端 use case harness，不接真实 macOS 能力。

后续新增目录时保持这个方向：

- `src/runtime`：session、trace、policy、capability registry。
- `src/adapters`：browser、mac、app-specific adapter。
- `native`：Swift mac helper。

规则：

- CLI 层不能直接调用 macOS API。
- runtime 层不能关心 shell 参数。
- adapter 层不能定义公共协议，只能实现协议。
- native helper 不能把 AXUIElement 等平台内部细节泄露给 TS contract。

## 依赖注入

优先通过函数参数或构造参数传依赖。

允许：

```ts
export function createRunner(adapter: Adapter, trace: TraceWriter): Runner
```

避免：

```ts
import { globalAdapter } from "./container.js"
```

全局状态会让 agent 调试变成猜谜，尤其是以后接 browser-harness、mac helper、policy guard 时。

## 错误与结果

CLI 对外只承诺结构化结果：

```ts
interface CommandResult<T extends object = object> {
  ok: boolean
  command: string
  data?: T
  error?: CommandError
}
```

约定：

- 成功返回 `ok: true`。
- 业务失败返回 `ok: false`，并给稳定 `error.code`。
- 未知异常返回 `UNEXPECTED_ERROR`。
- exit code `0` 表示成功。
- exit code `1` 表示非预期异常。
- exit code `2` 表示用户输入、参数或业务前置条件失败。

不要只返回自然语言错误。自然语言可以是 `message`，但机器判断必须靠 `code`。

下一步做 core contracts 时，应把 error code 从裸字符串收敛成常量表。

## CLI I/O

stdout 只输出协议结果，包括 `ok: false` 的结构化业务错误。

stderr 只输出：

- 日志。
- 调试信息。
- 非协议噪声。
- 未来的 trace 路径提示。

不要让 npm、logger、debug 输出污染 stdout。agent 会解析 stdout，当 stdout 混进人话，调用方就会坏。

`--pretty` 只改变 JSON 缩进，不改变字段结构。

## 文件与产物

必须忽略：

- `node_modules/`
- `dist/`
- env 文件。
- IDE 文件。
- 日志文件。
- agent 运行时临时文件。

`dist/` 是构建产物，不是源码事实来源。

## 测试策略

当前阶段不强制建立完整测试树。

但以下能力一旦冻结，必须补 contract/smoke 测试：

- core contracts。
- trace runtime。
- policy guard。
- mac helper protocol。
- browser-harness adapter。

测试重点不是覆盖率数字，而是协议不漂。

## 下一步任务

已完成：

- Core Contracts：`Target`、`Observation`、`ElementRef`、`Action`、`ActionResult`、`TraceEvent`、`AppCapability`。
- fake usecase runner 已使用 core contracts 生成 trace。
- CLI result/error code 已收敛成常量。
- Trace Runtime 已支持写 JSONL trace，并支持 `computer-use trace --last`。
- Policy Guard 已支持 blocked target 表，UC-060 已走 blocked trace。
- App Capability Registry 已支持 `computer-use apps` 和 `computer-use capabilities --app <name>`。
- Mac Helper Protocol 已定义 TS/Swift JSON-RPC stdio 边界。
- TS fake mac helper client 已接入 UC-020/030/040。
- TS stdio mac helper client 已支持消费 native JSON-RPC result/error。
- CLI native runner 已支持 `--mac-helper <path>`，并会把 native action failure 写入 trace。
- Swift minimal helper 已可编译，并支持 `permissionStatus`、`listApps`、`listWindows`、`getAppState`。
- Swift action 方法已支持 `click`、`type`、`key`、`scroll` 的请求校验和稳定 `ActionResult` 失败语义；当前仍不执行真实 UI 动作。

下一步进入 Mac Actions。

顺序：

1. 实现 `click`、`type`、`key`、`scroll` 的真实执行路径。
2. 给真实 action 补 element ref 解析和过期错误。
3. 每个真实 action 必须先经过 TS policy guard。
4. 每个真实 action 必须写 trace。
5. element ref 过期或权限缺失时返回稳定错误码。
6. 保持现有 CLI 输出兼容，不破坏已经跑通的 usecase、trace、apps、capabilities 命令。

从这里开始会碰到真实 macOS UI 权限：

- Accessibility：真实点击、键盘输入、读取部分 AX tree 需要。
- Screen Recording：完整窗口标题、截图、屏幕 fallback 需要；当前本机检测为 missing。
- Input Monitoring：部分键盘输入路径可能需要；当前 helper 只能报告 unknown。

不要在没有明确目标 App 和 policy 允许的情况下执行真实输入动作。
