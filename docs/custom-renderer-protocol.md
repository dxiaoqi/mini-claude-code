# Custom Renderer Protocol

版本：0.1（草案）

---

## 概述

Custom Renderer 允许用户提供一个独立的 Web 应用（任意框架）作为整个会话的渲染层。
blino 把 LLM 的输出流通过 `postMessage` 推入这个应用，应用自己决定如何展示和迭代内容。

典型场景：
- 整个对话就是一个在线文档，LLM 每次回复都是对文档的一次修订
- 整个对话就是一个设计画布，LLM 每次回复都更新画布状态
- 整个对话就是一个代码编辑器，LLM 每次回复都是一次 diff patch

---

## 架构

```
┌─────────────────────────────────────────────────────┐
│  blino UI (host)                                    │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  Custom Renderer (iframe, full-screen)       │   │
│  │                                              │   │
│  │  用户提供的 Next.js / Vite / 任意 Web 应用    │   │
│  │  通过 BlockSDK 与 host 通信                   │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  输入框（可选，renderer 也可以自己提供输入）           │
└─────────────────────────────────────────────────────┘
```

渲染器运行在 `<iframe sandbox="allow-scripts allow-same-origin allow-forms">` 里，
通过 `window.postMessage` 与 host 双向通信。

---

## 配置

在项目 `.blino/config.json` 或全局 `~/.blino/config.json` 里声明：

```json
{
  "renderer": {
    "url": "http://localhost:3003",
    "name": "My Design Tool",
    "description": "交互式设计画布",
    "inputMode": "host"
  }
}
```

字段说明：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | string | — | 渲染器地址，必填 |
| `name` | string | url | 显示名称 |
| `description` | string | — | 可选描述，注入 system prompt |
| `inputMode` | `"host"` \| `"renderer"` | `"host"` | 输入框由谁提供 |

`inputMode: "renderer"` 时 host 隐藏输入框，渲染器自己提供输入 UI，
通过 `SEND_MESSAGE` 消息触发对话。

---

## postMessage 协议

所有消息格式：`{ type: string; payload?: unknown }`

### Host → Renderer

#### `SESSION_INIT`
渲染器加载完成后，host 发送会话初始化信息。

```ts
{
  type: 'SESSION_INIT'
  payload: {
    sessionId: string
    model: string
    rendererConfig: {
      name: string
      description?: string
      inputMode: 'host' | 'renderer'
    }
  }
}
```

渲染器收到后应完成自身初始化，然后发送 `RENDERER_READY`。

---

#### `STREAM_EVENT`
LLM 输出流的每一个事件，直接透传 UIEvent。

```ts
{
  type: 'STREAM_EVENT'
  payload: UIEvent   // 见下方 UIEvent 类型
}
```

渲染器会收到完整的事件序列：
```
message.start → text.delta* → tool.start → tool.result → turn.complete → done
```

渲染器可以选择只消费自己关心的事件类型，忽略其他。

---

#### `CONTEXT_UPDATE`
会话上下文变化时推送（模型切换、设置变更等）。

```ts
{
  type: 'CONTEXT_UPDATE'
  payload: {
    model?: string
    sessionId?: string
  }
}
```

---

#### `THEME_UPDATE`
主题切换时推送宿主 CSS 变量，渲染器可选择跟随。

```ts
{
  type: 'THEME_UPDATE'
  payload: {
    cssVars: string   // ":root { --bg-primary: #fff; ... }"
    isDark: boolean
  }
}
```

---

### Renderer → Host

#### `RENDERER_READY`
渲染器初始化完成，通知 host 可以开始推送事件。

```ts
{
  type: 'RENDERER_READY'
  payload: {
    version?: string   // 渲染器版本，可选
  }
}
```

---

#### `SEND_MESSAGE`
渲染器触发一轮新的对话。

```ts
{
  type: 'SEND_MESSAGE'
  payload: {
    text: string
    context?: unknown   // 附加上下文，会追加到消息末尾（JSON 序列化后）
  }
}
```

---

#### `UPDATE_SYSTEM_PROMPT`
渲染器动态更新 system prompt addendum（追加到默认 system prompt 之后）。
通常在 `RENDERER_READY` 之后立即发送，告诉 LLM 当前渲染器的能力和输出格式要求。

```ts
{
  type: 'UPDATE_SYSTEM_PROMPT'
  payload: {
    addendum: string   // 追加到 system prompt 的内容
  }
}
```

---

#### `PERMISSION_RESPONSE`
响应工具权限请求（当 host 把 `permission.request` 事件转发给渲染器时）。

```ts
{
  type: 'PERMISSION_RESPONSE'
  payload: {
    requestId: string
    decision: 'allow' | 'deny'
  }
}
```

---

#### `RESIZE`
渲染器内容高度变化，通知 host 调整 iframe 尺寸。
如果渲染器是全屏布局可以不发这个消息。

```ts
{
  type: 'RESIZE'
  payload: number   // 内容高度 px
}
```

---

#### `OPEN_LINK`
请求 host 在新标签页打开链接。

```ts
{
  type: 'OPEN_LINK'
  payload: string   // URL
}
```

---

## UIEvent 类型参考

渲染器通过 `STREAM_EVENT` 收到的事件类型：

```ts
type UIEvent =
  // 文本流
  | { type: 'text.delta'; text: string }
  | { type: 'think.start' }
  | { type: 'think.delta'; text: string }
  | { type: 'think.end' }

  // 工具调用
  | { type: 'tool.start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool.delta'; id: string; partialInput: string }
  | { type: 'tool.result'; toolName: string; toolUseId: string; result: unknown; isError?: boolean }

  // 消息生命周期
  | { type: 'message.start'; messageId: string; model: string }
  | { type: 'message.end'; usage: Usage; stopReason: string }
  | { type: 'turn.complete'; turnCount?: number; usage?: Usage }
  | { type: 'done'; sessionId?: string }

  // 权限
  | { type: 'permission.request'; requestId: string; toolName: string; input: Record<string, unknown>; message: string; riskLevel: string }

  // 错误与状态
  | { type: 'error.occurred'; message: string }
  | { type: 'status'; message: string }
```

---

## 渲染器生命周期

```
1. host 加载 renderer URL 到 iframe
2. renderer 完成自身初始化
3. renderer 发送 RENDERER_READY
4. host 发送 SESSION_INIT
5. renderer 发送 UPDATE_SYSTEM_PROMPT（可选，告知 LLM 输出格式）
6. 用户发送消息（host 输入框 或 renderer 自己的输入）
7. host 发送 STREAM_EVENT 序列（message.start → ... → done）
8. renderer 根据事件更新自身状态
9. 重复 6-8
```

---

## 渲染器开发指南

### 最小实现（原生 JS）

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<div id="output"></div>
<script>
  let buffer = ''

  window.addEventListener('message', (e) => {
    const { type, payload } = e.data ?? {}

    switch (type) {
      case 'SESSION_INIT':
        // 初始化完成，告知 host 准备好了
        parent.postMessage({ type: 'RENDERER_READY' }, '*')

        // 告知 LLM 输出格式
        parent.postMessage({
          type: 'UPDATE_SYSTEM_PROMPT',
          payload: {
            addendum: '每次回复直接输出 Markdown 内容，不要解释，不要客套话。'
          }
        }, '*')
        break

      case 'STREAM_EVENT':
        const event = payload
        if (event.type === 'text.delta') {
          buffer += event.text
          document.getElementById('output').textContent = buffer
        }
        if (event.type === 'done') {
          // 一轮完成，可以做后处理
        }
        break
    }
  })
</script>
</body>
</html>
```

### Next.js 实现骨架

```tsx
// hooks/useBlino.ts
import { useEffect, useRef, useState } from 'react'

export function useBlino() {
  const [events, setEvents] = useState<UIEvent[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const ready = useRef(false)

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const { type, payload } = e.data ?? {}

      if (type === 'SESSION_INIT') {
        setSessionId(payload.sessionId)

        // 通知 host 准备好
        parent.postMessage({ type: 'RENDERER_READY' }, '*')

        // 注入 system prompt
        parent.postMessage({
          type: 'UPDATE_SYSTEM_PROMPT',
          payload: { addendum: '...' }
        }, '*')

        ready.current = true
      }

      if (type === 'STREAM_EVENT') {
        setEvents(prev => [...prev, payload])
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const sendMessage = (text: string, context?: unknown) => {
    parent.postMessage({ type: 'SEND_MESSAGE', payload: { text, context } }, '*')
  }

  return { events, sessionId, sendMessage }
}
```

---

## Host 侧实现要点

### 配置读取

启动时检查 `.blino/config.json`（项目级）和 `~/.blino/config.json`（全局级），
项目级优先。检测到 `renderer.url` 时进入 Custom Renderer 模式。

### iframe 挂载

```tsx
<iframe
  src={rendererConfig.url}
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  style={{ width: '100%', height: '100vh', border: 'none' }}
  onLoad={() => {
    // iframe 加载完成，等待 RENDERER_READY
  }}
/>
```

### 事件转发

SSE 流里的每个 UIEvent 直接转发给 renderer：

```ts
// 原来：processEvent(event) 更新 React 状态
// 现在：同时转发给 renderer
iframeRef.current?.contentWindow?.postMessage(
  { type: 'STREAM_EVENT', payload: event },
  '*'
)
```

### system prompt 注入

收到 `UPDATE_SYSTEM_PROMPT` 后，在下一轮 chat 请求里带上 `systemPromptAddendum`。
和现有 artifacts 模式的 addendum 机制复用同一套逻辑。

---

## 安全边界

- iframe 运行在 `sandbox` 属性限制下，无法访问 host 的 DOM 和 cookie
- `postMessage` 的 `targetOrigin` host 侧设为 `*`（renderer 可能是任意 origin），
  renderer 侧应验证 `e.origin` 是否为 blino host origin
- renderer URL 只允许 `http://localhost:*` 或 `https://` 开头，防止 `file://` 注入
- `UPDATE_SYSTEM_PROMPT` 的内容长度限制 8000 字符

---

## 与现有模式的关系

| 模式 | 渲染层 | 适用场景 |
|------|--------|----------|
| Agent 模式 | blino 内置消息列表 | 通用对话、代码、工具调用 |
| Artifacts 模式 | blino 内置 visual block | LLM 生成 SVG/HTML/3D |
| Custom Renderer | 用户提供的 Web 应用 | 领域专用工具、设计画布、文档编辑器 |

三种模式共享同一套 session/SSE 基础设施，只有渲染层不同。
