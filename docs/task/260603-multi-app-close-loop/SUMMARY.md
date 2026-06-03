# Task 260603 Summary

## 目标

完成 computer-use-harness 的多 App 真实操作闭环：在 QQ Music + Sublime Text 两个 case 基础上实现第二个真实 App usecase，复跑验证 trace 与文件系统证据，做必要的架构整理，并沉淀任务/知识文档。

## 完成状态

✅ **已完成**

## 交付物

### 1. UC-110 Sublime Text 用例

**状态**: PASSED

**文件**:
- `usecases/cases.yaml` - UC-110 定义
- `src/usecases/sublime-text.ts` - Sublime Text adapter 逻辑
- `src/usecases/native-runner.ts` - 集成 Sublime Text element binding 和验证
- `native/mac-helper/Sources/ComputerUseMacHelper/main.swift` - Sublime Text paste fallback

**证据**:
- [evidence/uc-110-pass.md](../evidence/uc-110-pass.md) - 完整 trace 和文件系统证据
- 文件 `/tmp/claude-501/computer-use-harness/uc-110.txt` 包含预期内容

**步骤**:
1. 打开 Sublime Text 并加载临时文件
2. 读取 app state
3. 关闭注册对话框（如果存在）
4. 聚焦文档窗口
5. 输入 sentinel 文本（使用 paste fallback）
6. 按 Command+S 保存
7. 验证文件系统内容

### 2. 架构 review

**文件**: [review/architecture-review.md](../review/architecture-review.md)

**核心发现**:
- ✅ 协议边界（CLI/Runtime/Helper/Policy/Trace）非常清晰
- ⚠️ App-specific 逻辑散布在多个文件中
- 推荐在接入第 3 个 App 前建立 **App adapter 模式**

**改进建议优先级**:
- P0: 建立 `AppAdapter` 接口和 app registry
- P1: 抽象 Swift 侧 app-specific handler
- P2: 对话框自动处理、element binding 可视化

### 3. 知识沉淀

**文件**: [knowledge/app-integration-learnings.md](../knowledge/app-integration-learnings.md)

**关键经验**:
- 文本输入的三种模式：AXValue / Focus+Paste / HID
- 验证策略：AX tree vs 文件系统 vs 外部观察
- Element binding 优先级：精确 > 语义 > 结构 > 坐标
- Policy 和 Trace 的设计原则

### 4. 文档更新

- `README.md` - 更新当前能力和真实 usecase 验证状态
- `ROADMAP.md` - 更新 M6/M7/M10 状态为 Done，添加下一步建议
- `docs/task/260603-multi-app-close-loop/progress.md` - 完整进度追踪

## 验收标准达成情况

| 标准 | 状态 | 证据 |
|------|------|------|
| QQ 音乐用例可复跑 | ✅ | UC-100 已存在，通过 native runner |
| Sublime Text 用例端到端完成 | ✅ | UC-110 PASSED，7/7 步骤通过 |
| 保存的文件真实存在 | ✅ | `/tmp/claude-501/computer-use-harness/uc-110.txt` |
| 文件内容与输入一致 | ✅ | 内容为 `computer-use-harness: uc-110` |
| 有可复用的任务/知识文档 | ✅ | `docs/task/260603-multi-app-close-loop/` |
| 有架构 review 输出 | ✅ | `review/architecture-review.md` |
| 结论和修改落到仓库 | ✅ | 所有修改已提交到工作区 |

## 技术亮点

1. **文件系统验证**：Sublime Text 用例不依赖 AX tree 状态，而是读取实际文件内容验证
2. **对话框处理**：显式处理 Sublime Text 注册对话框，记录在 trace 中
3. **Paste fallback**：为不暴露标准文本输入元素的 App 提供 paste 输入方式
4. **App-specific 隔离**：QQ Music 和 Sublime Text 的特化逻辑明确标识，不污染通用路径

## 下一步建议

在接入第 3 个 App（如 VS Code / IntelliJ IDEA）之前：

1. **重构为 App adapter 模式**
   - 定义 `AppAdapter` 接口
   - 迁移 QQ Music 和 Sublime Text 到 `src/adapters/apps/`
   - 建立 app registry 和查找机制

2. **抽象通用能力**
   - `FileSystemVerifier` 独立模块
   - `DialogHandler` 自动检测和关闭
   - Element binding 可视化

3. **补充测试覆盖**
   - Element binding 逻辑的单元测试
   - Policy evaluation 的边界测试
   - Trace 格式的 schema 验证

## Token 消耗

任务全程约 82k tokens，控制在预算内。主要消耗在：
- 理解现有代码结构
- 调试 Sublime Text 对话框和文本输入问题
- 编写架构 review 和知识文档

## 经验总结

**做得好的**：
- 真实闭环优先，不做纸上谈兵
- 文件系统证据链完整
- 踩坑经验立即沉淀进文档

**可以更好的**：
- 第一次运行时可以先截图看 AX tree，减少盲试
- Element binding 失败时应该输出更详细的调试信息
- 可以更早做架构 review，在第二个 App 之前就规划 adapter 模式

**核心收获**：
- 不同 App 的 AX 支持差异巨大，fallback 是常态而非特例
- 验证必须看外部状态（文件/截图/网络），不能只信 AX tree
- Trace 不是调试工具，而是核心产品能力
