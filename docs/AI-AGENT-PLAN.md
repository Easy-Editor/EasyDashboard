# EasyDashboard AI Agent 计划

> 当前阶段：**UI 设计**
> 更新时间：2026-02-03
> 核心问题已全部确认 ✓

---

## 一、产品愿景

### 核心理念
**AI 优先，编辑器是精调工具** —— 用户从 AI 对话开始，而不是从空白画布开始。

### 产品定位
```
传统模式: 打开编辑器 → 拖组件 → 配置
新模式:   描述需求 → AI 生成 → 微调
```

### 用户旅程
```
[首页]          [AI 工作台]        [编辑器]         [预览]
极简输入框  →   左右分屏对话   →   完整编辑能力  →   最终效果
               流式生成预览        AI 辅助面板
```

---

## 二、产品设计（已确认）

### 交互阶段

**Stage 1: 首页 - 极简入口**
- 居中大输入框
- 快捷建议模板
- 历史记录列表

**Stage 2: AI 工作台 - 左右分屏**
- 左侧：AI 多轮对话
- 右侧：实时预览画布（流式生成）
- 右侧可收起，可跳转编辑器

**Stage 3: 编辑器 - 完整功能**
- 现有编辑器能力
- 可呼出 AI 面板辅助
- 双向跳转 AI 工作台

### 核心能力
| 能力 | 优先级 | 说明 |
|------|--------|------|
| 整页生成 | P0 | 自然语言生成完整大屏 |
| 组件修改 | P0 | 选中组件后智能修改 |
| 局部生成 | P0 | 在指定位置添加组件 |
| 布局优化 | P1 | 自动对齐、均匀分布 |
| 数据建议 | P1 | 分析数据推荐图表 |
| 批量修改 | P1 | 条件筛选批量操作 |

### 交互决策
- **生成方式**：流式生成（组件逐个出现）
- **操作确认**：自动执行（可撤销）
- **数据来源**：模拟数据 + 用户输入 + 数据源对接
- **保存机制**：自动保存

---

## 三、核心问题决策（已确认 ✓）

### 产品层面

| 问题 | 决策 | 说明 |
|------|------|------|
| **核心价值** | 三者兼顾 | 更快+更简单+更智能，综合体验 |
| **AI 理解错误** | 混合策略 | 简单问题直接猜测，复杂问题追问确认 |
| **能力边界** | 尽力而为 | 尝试最接近的实现，并告知局限性 |
| **与 v0 差异化** | 四大差异 | ① 数据可视化领域专注<br>② 可视化编辑器<br>③ 数据智能分析<br>④ 数据源集成 |

### 技术层面

| 问题 | 决策 | 说明 |
|------|------|------|
| **流式 JSON 解析** | 增量解析 | 使用 jsonrepair/partial-json 实时解析不完整 JSON |
| **大画布上下文** | 混合策略 | 智能截取（只发送相关组件）+ 摘要压缩 |
| **Tool Calling 统一** | SDK 抽象层 | 使用 Vercel AI SDK 统一封装各模型差异 |
| **Schema 校验** | 自动修复 | JSON Schema 校验 + 补全默认值 + 类型转换 |

### 体验层面

| 问题 | 决策 | 说明 |
|------|------|------|
| **画布闪烁** | 动画过渡 | 组件添加时使用淡入动画，让变化更平滑 |
| **上下文管理** | 混合策略 | 滑动窗口（保留最近 N 轮）+ AI 摘要（压缩早期历史） |
| **错误恢复** | 双重机制 | Undo/Redo（短期操作）+ 快照版本（重大变更回滚） |

---

## 四、竞品研究报告

### 4.1 v0.dev（已研究 ✓）

**产品定位**：AI 驱动的 UI 生成平台

**技术栈**：
- React + Tailwind CSS + shadcn/ui
- 支持 Next.js Server Components
- 也支持 Svelte、Vue、Remix

**核心交互设计**（基于截图分析）：
```
┌────────────────────────────────────────────────────────────────┐
│ 左侧导航栏 (可完全收缩)                                          │
│ ├── Chat      - 对话生成                                       │
│ ├── Design    - 设计配置                                       │
│ ├── Git       - 版本管理                                       │
│ ├── Connect   - 连接外部服务                                   │
│ ├── Vars      - 变量管理                                       │
│ └── Settings  - 设置                                           │
├────────────────────────────────────────────────────────────────┤
│ 生成过程可视化                                                  │
│ ├── 💭 Thought for Xs     (思考耗时)                           │
│ ├── ✨ 设计灵感已生成       (阶段提示)                          │
│ ├── 🔍 Explore - N Files   (探索文件)                          │
│ └── 📄 布局元数据已更新     (状态更新)                          │
├────────────────────────────────────────────────────────────────┤
│ 版本管理                                                        │
│ └── "主页面已创建 v1" - 支持版本历史和回滚                       │
├────────────────────────────────────────────────────────────────┤
│ 底部固定输入框                                                  │
│ └── 任何界面都能快速追问，保持 AI 交互入口                       │
└────────────────────────────────────────────────────────────────┘
```

**借鉴点**：
- 侧边栏多功能切换 + 底部统一输入框
- 生成过程的可视化反馈
- 版本管理系统
- 面板可完全收缩

---

### 4.2 Cursor（代码 AI 助手）

**产品定位**：AI 原生的代码编辑器（VS Code fork）

**架构特点**：
- 多云、边缘优化、模型无关
- 支持 GPT-4、Claude 3.5 Sonnet、Gemini 等多模型
- 项目级上下文感知（不只是单文件）

**核心能力**：
| 功能 | 说明 |
|------|------|
| **15+ 专用工具** | 语义代码搜索、上下文编辑、沙箱执行 |
| **Tab 预测** | 自研模型，21% 更少建议，28% 更高接受率 |
| **Composer 模式** | 多 Agent 界面，自动化编程 |
| **MCP 集成** | 连接外部数据源和工具 |

**隐私架构**：
- Privacy Mode: 代码通过临时容器处理，用完即销毁
- Normal Mode: 代码加密后发送到云端

**借鉴点**：
- 项目级上下文感知，不只看当前文件
- 工具编排系统（15+ 专用工具）
- Tab 模型的预测式交互

Sources: [Cursor Deep Dive](https://collabnix.com/cursor-ai-deep-dive-technical-architecture-advanced-features-best-practices-2025/), [Cursor Architecture](https://medium.com/@lakkannawalikar/cursor-ai-architecture-system-prompts-and-tools-deep-dive-77f44cb1c6b0)

---

### 4.3 Dify（Agent 工作流平台）

**产品定位**：开源 LLM 应用开发平台

**三大核心模块**：
```
┌─────────────────────────────────────────────────────────────┐
│                        Dify 架构                            │
├─────────────────────────────────────────────────────────────┤
│  LLM 编排层        │  可视化工作室      │  部署中心          │
│  ─────────────     │  ─────────────     │  ─────────────     │
│  多模型切换        │  拖拽式 Workflow   │  一键部署 API      │
│  统一接口          │  Agent 训练        │  Chatbot 发布      │
│                   │  RAG 配置          │  内部工具集成       │
└─────────────────────────────────────────────────────────────┘
```

**Agent Node 设计**：
- 作为 Workflow 的"决策中心"
- 可插拔的推理算法模块
- 解耦设计：引擎和控制系统分离

**2025 新特性**：
- 插件生态和市场
- OAuth 安全集成
- 可导出为 MCP Server

**借鉴点**：
- 可视化 Workflow 编排
- 插件化架构，可扩展性强
- 渐进式使用体验（初学者到高级用户）

Sources: [Dify Official](https://dify.ai/), [Dify GitHub](https://github.com/langgenius/dify), [Dify Agent Node](https://dify.ai/blog/dify-agent-node-introduction-when-workflows-learn-autonomous-reasoning)

---

### 4.4 ChatGPT Canvas（协作编辑）

**产品定位**：AI 协作式文档/代码编辑器

**核心特点**：
- 独立窗口，侧边协作
- 实时编辑，非纯对话
- 支持版本历史

**写作功能**：
- 内联建议和反馈
- 调整文档长度
- 调整阅读级别（幼儿园到研究生）
- 语法润色

**编码功能**：
- 内联代码改进建议
- 自动添加 print 语句调试
- 添加代码注释
- 检测并重写问题代码
- 多语言转换（JS/TS/Python/Java/C++/PHP）

**借鉴点**：
- 侧边协作模式而非纯对话
- 针对不同任务（写作/编码）的专用工具
- 内联建议而非全量替换

Sources: [OpenAI Canvas](https://openai.com/index/introducing-canvas/), [Canvas Guide](https://www.certlibrary.com/blog/comprehensive-guide-to-chatgpt-canvas-features-usage-and-examples/)

---

## 五、技术框架研究

### 5.1 Vercel AI SDK（推荐 ✓）

**最新版本**：AI SDK 5/6（2025）

**核心特性**：
| 特性 | 说明 |
|------|------|
| **统一接口** | OpenAI、Anthropic、Google、开源模型 |
| **流式输出** | 基于 SSE，浏览器原生支持 |
| **Tool Calling** | 完整类型安全，支持输入流式传输 |
| **useChat Hook** | 10-20 行代码实现完整聊天 UI |

**Agent 支持**（AI SDK 5 新增）：
```typescript
// stopWhen - 定义工具循环何时停止
// ToolLoopAgent - 生产就绪的 Agent 实现
// Human-in-the-Loop - 危险操作需要审批
```

**Human-in-the-Loop 示例**：
```typescript
// 简单命令自动批准，危险命令需要确认
needsApproval: (toolCall) => {
  if (toolCall.name === 'deleteFile') return true
  return false
}
```

**消息 Parts**（AI SDK 4.2+）：
- Text: `{ type: 'text', text: 'Hello' }`
- Images: 多模态支持
- Tool Calls: 工具调用

**选择理由**：
- React 生态原生支持
- 轻量级，不像 LangChain 那么重
- Vercel 维护，与 Next.js 完美集成
- 完整的类型安全

Sources: [AI SDK 5](https://vercel.com/blog/ai-sdk-5), [AI SDK 6](https://vercel.com/blog/ai-sdk-6), [AI SDK Docs](https://ai-sdk.dev/docs/introduction)

---

## 六、对 EasyDashboard 的启发

### 设计借鉴汇总

| 来源 | 借鉴点 | 应用到 EasyDashboard |
|------|--------|---------------------|
| v0 | 侧边栏多功能 + 底部统一输入 | 左侧面板设计 |
| v0 | 生成过程可视化 | 流式生成的进度反馈 |
| v0 | 版本管理 | 大屏版本历史 |
| Cursor | 项目级上下文感知 | 理解整个画布状态 |
| Cursor | 多工具编排 | 画布操作工具系统 |
| Dify | 可视化 Workflow | 未来高级功能 |
| Dify | 插件化架构 | 可扩展的工具系统 |
| Canvas | 侧边协作模式 | 左右分屏布局 |
| Canvas | 内联建议 | 选中组件时的快捷操作 |

### 产品差异化思考

```
v0.dev          → 纯前端 UI 生成
Cursor          → 代码编辑器 + AI
Dify            → Agent 工作流平台
ChatGPT Canvas  → 通用文档/代码编辑

EasyDashboard   → 数据可视化大屏 + AI
                  专注垂直领域
                  结合低代码编辑器
                  数据驱动的智能推荐
```

---

## 七、UI 设计方案

### 7.1 整体布局

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Logo   EasyDashboard AI                              [保存] [预览] [发布]  │
├────┬────────────────────────────────────┬───────────────────────────────────┤
│    │                                    │                                   │
│ 侧 │   功能面板区域                      │        画布预览区域                │
│ 边 │   (根据选中的侧边栏切换)             │                                   │
│ 导 │                                    │   ┌───────────────────────────┐   │
│ 航 │   ┌──────────────────────────┐    │   │                           │   │
│    │   │                          │    │   │      大屏实时预览          │   │
│ 💬 │   │   Chat 时显示对话历史     │    │   │                           │   │
│Chat│   │   Design 时显示配置面板   │    │   │   (流式生成时逐个显示组件)  │   │
│    │   │   Data 时显示数据源      │    │   │                           │   │
│ 🎨 │   │   History 时显示版本     │    │   │                           │   │
│Design│ │                          │    │   └───────────────────────────┘   │
│    │   │                          │    │                                   │
│ 📊 │   │                          │    │        [全屏] [缩放] [↗编辑器]    │
│Data│   │                          │    │                                   │
│    │   └──────────────────────────┘    │                                   │
│ 📜 │                                    │                                   │
│History│                                 │                                   │
│    │                                    │                                   │
│ ⚙️ │   ┌──────────────────────────┐    │                                   │
│Settings│ [AI 输入框 - 始终可见]     ↵ │    │                                   │
│    │   └──────────────────────────┘    │                                   │
└────┴────────────────────────────────────┴───────────────────────────────────┘
       ↑                                   ↑
    可收缩                              可收缩/全屏
```

### 7.2 设计系统（Terminal Minimal）

**设计理念**：终端/IDE 风格的暗黑模式仪表盘，适合 AI/开发者工具

**配色方案**:
```
页面背景:     #0A0A0A (终端黑)
卡片背景:     #0F0F0F (略提升)
边框:         #1F1F1F (微弱分隔)
文字主色:     #FAFAFA (白)
文字次色:     #6B7280 (灰)
文字三级:     #4B5563 (深灰)
主强调色:     #10B981 (翠绿 - AI/活跃状态)
警告色:       #F59E0B (琥珀)
信息色:       #06B6D4 (青色)
语法色:       #8B5CF6 (紫色)
```

**字体方案**:
```
主字体:       JetBrains Mono (UI、标题、导航)
辅助字体:     IBM Plex Mono (描述、时间戳)
```

**CLI 风格文本**:
```
注释标题:     "// section_name"
命令提示:     "$ command"
路径标记:     "directory_name/"
分页括号:     "[1]" "[2]"
状态变化:     "++" "--"
导航箭头:     ">>" "<<"
```

**设计特点**:
- 零圆角（sharp corners - 终端美学）
- 无阴影（flat design）
- 状态点（6-8px 圆点表示状态）
- 光标图标（绿色矩形，终端风格）

---

## 八、后续阶段

```
Phase 1: 研究学习        ✓ 已完成
Phase 2: 产品设计确认    ✓ 已完成
Phase 3: UI 设计         ← 当前阶段
Phase 4: 技术架构设计
Phase 5: 开发实现
Phase 6: 测试优化
```

---

## 九、参考资源

### 文档
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Anthropic Tool Use](https://docs.anthropic.com/claude/docs/tool-use)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [LangChain.js](https://js.langchain.com/docs)

### 论文/文章
- ReAct: Synergizing Reasoning and Acting in Language Models
- Chain-of-Thought Prompting
- Tree of Thoughts

### 开源项目
- [Dify](https://github.com/langgenius/dify) - Agent 平台
- [LobeChat](https://github.com/lobehub/lobe-chat) - AI 聊天应用
- [Vercel AI SDK Examples](https://github.com/vercel/ai)
