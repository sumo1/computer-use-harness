# Architecture Review - 2026-06-03

基于 UC-100 (QQ Music) 和 UC-110 (Sublime Text) 两个真实闭环的架构审查。

## 审查范围

- CLI / runtime / usecase / native-helper / app-specific fallback
- Policy / trace / verifier 边界
- 通用能力 vs App 特化能力的分层

## 发现

### ✅ 做得好的部分

#### 1. Trace 是一等公民

所有 action 都记录了完整的 trace：
- policy decision 在 action 之前
- observation / action / result 有序记录
- 验证证据（file-system verifier）进入 trace metadata

这让 trace 不只是调试工具，而是可审查的执行证据。

#### 2. App-specific fallback 隔离明确

**Swift helper 层**：
- `isQQMusicTarget` / `isSublimeTextTarget` 明确标识特化逻辑
- QQ Music 使用 `clickElementCenterToPid` + `pasteTextToPid`
- Sublime Text 使用 `pasteTextToPid`（无需预先点击，因为窗口已激活）
- 特化逻辑不污染通用 AX 路径

**TS runtime 层**：
- `bindElement` 中 QQ Music / Sublime Text 的 element binding 逻辑清晰分段
- `verifySublimeTextAction` 和 QQ Music playback verifier 各自独立
- `sublime-text.ts` 模块封装了 Sublime 的准备、绑定和验证逻辑

#### 3. Policy 先于执行

每个 action 都先经过 `evaluatePolicy`，blocked 的 action 不会到达 helper。

Policy decision 写入 trace，可审查。

#### 4. 失败语义稳定

Swift helper 返回的错误码清晰：
- `TARGET_NOT_FOUND`
- `ELEMENT_NOT_FOUND`
- `ACTION_FAILED`
- `UNIMPLEMENTED`

TS runtime 不需要解析自然语言错误消息。

#### 5. 验证不依赖 AX 状态

- QQ Music：检查 AX tree 中是否有"歌曲名 鸭子"和"暂停"按钮
- Sublime Text：读取文件系统的真实字节，而不是信任 AX tree

这避免了"UI 看起来对但实际没生效"的假阳性。

### ⚠️ 需要改进的部分

#### 1. App-specific logic 散布在多个位置

**当前状态**：

QQ Music 特化逻辑分布在：
- `src/usecases/native-runner.ts` - `bindElement` 中的 search input / playable duck / search all play point
- `native/mac-helper/Sources/ComputerUseMacHelper/main.swift` - `isQQMusicTarget` / `isQQMusicSearchElement` / click + paste fallback

Sublime Text 特化逻辑分布在：
- `src/usecases/sublime-text.ts` - `prepareSublimeTextUseCase` / `bindSublimeTextActionInput` / `verifySublimeTextAction`
- `src/usecases/native-runner.ts` - `bindElement` 中的 window binding / cancel button binding
- `native/mac-helper/Sources/ComputerUseMacHelper/main.swift` - `isSublimeTextTarget` / paste fallback

**问题**：
- 新接入一个 App 时，需要在 3 个文件中分别添加逻辑
- `native-runner.ts` 的 `bindElement` 函数越来越长
- App 特化逻辑没有统一的注册/发现机制

**建议**：
- 考虑 app-specific adapter 模式：每个 App 一个独立模块
- `src/adapters/apps/qq-music.ts`
- `src/adapters/apps/sublime-text.ts`
- 每个 adapter 导出：`prepareUseCase` / `bindActionInput` / `bindElement` / `verifyAction`
- `native-runner` 通过 app registry 查找并调用对应 adapter

#### 2. Element binding 逻辑复杂

`bindElement` 函数现在有多层条件分支：
- Sublime Text type -> 找 window
- Sublime Text click -> 找 Cancel button 或 document window
- QQ Music click -> 计算固定坐标 或 找 playable duck
- QQ Music type -> 找 search input

这个函数每新增一个 App 都会膨胀。

**建议**：
- 每个 App adapter 提供自己的 `bindElement` 实现
- `native-runner` 只负责调度：`adapter?.bindElement(action, observation) ?? action`

#### 3. Swift helper 的 app-specific 判断顺序

`performType` 中的判断顺序：
1. 有 element 吗？没有 -> 失败
2. element 是标准文本输入吗？是 -> 用 AXValue 或 paste
3. 是 Sublime Text 吗？是 -> paste
4. 是 QQ Music 吗？是 -> click + paste
5. 否则 -> 拒绝

**问题**：
- Sublime Text 的判断在 QQ Music 之前，但两者互不冲突，顺序无所谓
- 如果有第 3 个 App，又要加一层 `if isFooTarget`

**建议**：
- 抽象成 app-specific type handler 表
- Swift 侧维护 `[String: TypeHandler]`，key 是 bundle ID
- 每个 handler 负责自己的 type 逻辑
- 通用路径在找不到 handler 时拒绝

#### 4. 文件系统验证只在 Sublime Text 中实现

QQ Music 依赖 AX tree 验证播放状态，Sublime Text 验证文件系统。

**问题**：
- 如果未来需要验证 QQ Music 的"我的喜欢"列表是否真的加了歌，AX tree 不够
- 文件系统验证的模式（读文件、比对内容）是通用的，但现在只在 `sublime-text.ts` 中

**建议**：
- 抽象 `FileSystemVerifier` 为通用能力
- 任何 App 的 usecase 都可以用文件系统验证
- Sublime Text adapter 只需要声明"这一步需要文件验证"，而不是自己实现读文件逻辑

#### 5. 对话框处理硬编码在步骤中

Sublime Text 的 "dismiss registration dialog" 是一个显式步骤。

**问题**：
- 如果 QQ Music 也弹对话框（比如"发现新版本"），需要在每个 usecase 中都加步骤
- 对话框处理应该是 App adapter 的责任，而不是 usecase 作者需要记住的细节

**建议**：
- App adapter 提供 `handleUnexpectedDialogs(observation)` 钩子
- `native-runner` 在每次 observation 后自动调用，尝试关闭已知对话框
- 对话框关闭记录在 trace 中，但不占用 usecase step

### 📊 边界清晰度评分

| 边界 | 清晰度 | 说明 |
|------|--------|------|
| CLI ↔ Runtime | ✅ 清晰 | CLI 只负责解析命令和格式化输出，不处理业务逻辑 |
| Runtime ↔ Policy | ✅ 清晰 | Policy 在 action 执行前独立评估，decision 进入 trace |
| Runtime ↔ Trace | ✅ 清晰 | 所有 action/observation/result 都写入 trace，trace 是独立 artifact |
| Runtime ↔ Helper | ✅ 清晰 | JSON-RPC stdio 协议，TS 不直接调用 macOS API |
| Generic ↔ App-specific (TS) | ⚠️ 模糊 | App 特化逻辑散布在多个位置，没有统一 adapter 接口 |
| Generic ↔ App-specific (Swift) | ⚠️ 模糊 | App 特化逻辑通过 if 堆叠，没有 handler 注册机制 |
| Action ↔ Verifier | ✅ 清晰 | Verifier 独立于 action 执行，可以验证文件系统等外部状态 |

## 推荐改进优先级

### P0 - 立即改进（阻碍扩展性）

**建立 App adapter 模式**
- 创建 `src/adapters/apps/` 目录
- 定义 `AppAdapter` 接口
- 迁移 QQ Music 和 Sublime Text 到独立 adapter 模块
- `native-runner` 通过 app registry 查找 adapter

### P1 - 短期改进（减少维护负担）

**抽象 Swift 侧 app-specific handler**
- 定义 handler 协议
- 注册表映射 bundle ID -> handler
- QQ Music / Sublime Text handler 独立实现

**抽象文件系统验证**
- 通用 `FileSystemVerifier` 模块
- 支持文件内容、文件存在性、JSON 结构验证

### P2 - 长期改进（提升用户体验）

**对话框自动处理**
- App adapter 声明已知对话框和关闭策略
- Runtime 自动检测和关闭

**Element binding 可视化**
- Trace 中记录 element binding 的决策过程
- 失败时明确说明"尝试了哪些 selector，为什么都不匹配"

## 结论

当前架构在 **协议边界**（CLI/Runtime/Helper/Policy/Trace）上非常清晰，这是核心优势。

最大的改进空间在 **App 特化逻辑的组织方式** 上。当前两个 App 的特化逻辑散布在多个文件中，这会随着 App 数量增长变成维护噩梦。

建议在接入第 3 个 App 之前，先建立 **App adapter 模式**，让每个 App 的特化逻辑都有自己的模块，而不是继续往 `native-runner.ts` 和 `main.swift` 里堆 if 分支。
