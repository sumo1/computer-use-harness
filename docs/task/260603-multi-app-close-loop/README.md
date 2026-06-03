# 260603 Multi-App Close Loop

这个任务把 `computer-use-harness` 从单一 QQ Music case 推向可持续扩展的多 App 工程体系。

## 当前阶段

- M1: 任务文档骨架 - done
- M2: Sublime Text usecase - pending
- M3: 架构 review - pending
- M4: 知识沉淀 - pending

## 入口

- [progress.md](./progress.md)
- [plan/01-sublime-text-usecase-contract.md](./plan/01-sublime-text-usecase-contract.md)
- [plan/02-architecture-review-bootstrap.md](./plan/02-architecture-review-bootstrap.md)

## 为什么要做

1. QQ Music 已证明：AX 树和 helper 返回值不能直接当完成证据。
2. 第二个 App 必须是不同形态的桌面应用，才能看出 generic 和 app-specific 的边界。
3. 任务判断、失败路径、验证证据都必须进仓库，不能只留在会话里。

## QQ Music 已有证据

- [usecases/cases.yaml](../../../usecases/cases.yaml) 已定义 UC-100。
- [src/usecases/native-runner.ts](../../../src/usecases/native-runner.ts) 已有 QQ Music 专用 verifier 和 element binding。
- [native/mac-helper/Sources/ComputerUseMacHelper/main.swift](../../../native/mac-helper/Sources/ComputerUseMacHelper/main.swift) 已有 QQ Music 专用 HID / paste / key fallback。
- [README.md](../../../README.md) 已明确 native helper smoke 和 trace 预期。

## 角色分工

- `goal-designer`: 拆任务，写施工契约和验收契约。
- `app-coder`: 实现 Sublime usecase 和必要的 adapter/helper 能力。
- `runtime-architect`: 审查分层、边界和可扩展性。
- `safety-reviewer`: 审查真实 UI 动作和 policy 风险。
- `trace-evaluator`: 独立复跑 CLI，看 trace 是否能证明真实完成。
- `doc-refresher`: 盯文档和代码同步。
- `knowledge-dreamer`: 把 QQ Music / Sublime 的判断上浮成长期知识。
