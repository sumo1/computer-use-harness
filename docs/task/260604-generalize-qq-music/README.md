# Task: Generalize QQ Music Adapter

## 目标

移除 QQ Music adapter 中的硬编码逻辑，使其成为通用的 QQ Music 操作能力，而不是只能"搜鸭子并播放"。

## 当前问题

1. **硬编码搜索词**：
   - `findPlayableDuck` 只找名字包含"鸭子"的元素
   - `verifyAction` 验证逻辑检查"鸭子"字符串

2. **硬编码验证逻辑**：
   - 只验证"播放状态"（检查暂停按钮）
   - 无法支持其他场景（如读取搜索结果、专辑信息）

3. **缺少通用 element finding**：
   - `findPlayableDuck` 应该是 `findSearchResult`，接受关键词参数
   - 应该能找任意文本的搜索结果，不只是"鸭子"

## 设计方向

### 1. 参数化搜索

UseCase 应该支持参数：

```yaml
- id: UC-100
  title: Search and play in QQ Music
  parameters:
    searchQuery: "鸭子"
    resultFilter: "鸭子"
  steps:
    - open app
    - read app state
    - find search input
    - type {searchQuery} into search input
    - press Enter
    - find result containing {resultFilter}
    - click result
```

### 2. 通用 element finding

Adapter 应该支持：
- `findSearchResult(elements, keyword)` - 找包含任意关键词的搜索结果
- 不预设"播放"行为，只负责找元素

### 3. 移除 app-specific 验证

播放验证应该：
- 要么移到通用的"检查 AX tree 包含文本"逻辑
- 要么移到 usecase-specific verifier（不在 adapter 里）

### 4. 信息提取能力（可选）

如果要支持"读取搜索结果"场景：
- 新的 action kind: `extract`
- 从 observation 中提取匹配的元素名称列表
- 返回给用户

## 实施计划

### Phase 1: 移除硬编码
- [ ] `findPlayableDuck` → `findSearchResult(keyword)`
- [ ] 移除 `verifyAction` 中的"鸭子"验证
- [ ] UC-100 改为参数化（如果支持）

### Phase 2: 通用化 element finding
- [ ] 抽象"找包含文本的可点击元素"逻辑
- [ ] 支持多种元素类型（歌曲/专辑/歌手）

### Phase 3: 验证策略调整
- [ ] 播放验证移到 usecase level 或通用 verifier
- [ ] Adapter 只负责 element binding，不负责业务验证

## 验收标准

- [ ] UC-100 仍然 PASSED（向后兼容）
- [ ] 可以创建新 usecase：搜索"周杰伦"，点击第一个结果
- [ ] Adapter 代码中没有"鸭子"字符串
- [ ] `findSearchResult` 接受参数，不硬编码关键词

## 非目标

- 不在本次实现信息提取能力（extract action）
- 不实现"找最新专辑"逻辑（需要更复杂的语义理解）
- 保持 Swift helper 不变（问题在 TS adapter）

## 启动

准备开始 Phase 1。
