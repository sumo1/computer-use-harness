# Task: Vision-based Information Extraction

## 目标

为 capability 架构添加 Vision + LLM 能力，实现：
1. 截图当前窗口
2. 用 Claude Vision API 理解内容
3. 提取结构化信息（如"周杰伦最新专辑"）
4. 返回给用户

## 设计

### 1. 新增 action kind: `extract`

```typescript
{
  kind: "extract",
  input: {
    description: "find Jay Chou's latest album",
    query: "找到周杰伦的最新专辑名称和发布日期",
    schema: {
      albumName: "string",
      releaseDate: "string"
    }
  }
}
```

### 2. 新增 ScreenshotVisionCapability

```typescript
class ScreenshotVisionCapability implements Capability {
  async execute(action: Action) {
    // 1. 截图
    const screenshot = await this.takeScreenshot(action.target)
    
    // 2. 调用 Claude Vision
    const result = await this.extractWithVision(
      screenshot,
      action.input.query,
      action.input.schema
    )
    
    // 3. 返回结构化数据
    return { success: true, data: result }
  }
}
```

### 3. 使用 Anthropic SDK

```typescript
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

const response = await anthropic.messages.create({
  model: "claude-3-5-sonnet-20241022",
  messages: [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", data: screenshot } },
      { type: "text", text: query }
    ]
  }]
})
```

## 实施计划

### Phase 1: 基础设施
- [ ] 安装 @anthropic-ai/sdk
- [ ] 添加 screenshot 能力（通过 Swift helper）
- [ ] 定义 extract action kind

### Phase 2: Vision Capability
- [ ] 实现 ScreenshotVisionCapability
- [ ] 集成到 capability chain
- [ ] 处理错误和重试

### Phase 3: UC-102 验证
- [ ] 创建 UC-102: Find Jay Chou latest album
- [ ] 运行并验证
- [ ] 返回结构化结果

## 验收标准

- [ ] UC-102 能搜索"周杰伦"
- [ ] 截图搜索结果页面
- [ ] Claude Vision 识别出最新专辑名称
- [ ] 返回 JSON: `{ albumName: "...", releaseDate: "..." }`

## 启动

开始 Phase 1。
