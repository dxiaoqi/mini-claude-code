# Blino — 功能测试说明

> 以下测试用例覆盖所有已实现的功能模块。
> 环境变量设置：
> ```bash
> export ANTHROPIC_API_KEY="your_key"
> export ANTHROPIC_BASE_URL="https://your-api.com"
> ```

---

## 1. 基础对话

```bash
# 纯文本对话（无工具调用）
echo "请用一句话介绍你自己" | npx tsx src/cli.ts -p

# 预期：返回自我介绍文本，无工具调用
```

## 2. BashTool

```bash
# 安全命令（自动通过，不需要权限确认）
echo "执行 ls -la 命令" | npx tsx src/cli.ts -p

# 危险命令（应被拦截）
echo "执行 rm -rf /tmp/test" | npx tsx src/cli.ts -p
# 预期：权限被拒绝，模型解释原因

# 多命令组合
echo "执行 pwd && echo hello" | npx tsx src/cli.ts -p
```

## 3. FileReadTool

```bash
# 读取文件
echo "读取 package.json 文件" | npx tsx src/cli.ts -p
# 预期：显示 package.json 内容（带行号）

# 读取指定行范围
echo "读取 src/types.ts 的前10行" | npx tsx src/cli.ts -p
```

## 4. FileWriteTool + FileEditTool

```bash
# 创建文件（含自动创建目录）
echo '创建文件 test-output/hello.txt，内容为 "Hello World"' | npx tsx src/cli.ts -p
# 预期：文件创建成功
# 验证：cat test-output/hello.txt

# 精确编辑
echo '用 FileEdit 把 test-output/hello.txt 里的 "World" 替换成 "Mini Claude"' | npx tsx src/cli.ts -p
# 预期：精确替换成功
# 验证：cat test-output/hello.txt → "Hello Mini Claude"

# 清理
rm -rf test-output/
```

## 5. GlobTool + GrepTool

```bash
# 文件搜索
echo "用 Glob 找到所有 .ts 文件" | npx tsx src/cli.ts -p
# 预期：列出所有 TypeScript 文件

# 内容搜索
echo '用 Grep 搜索 "checkPermissions" 在 src/ 目录下出现在哪些文件' | npx tsx src/cli.ts -p
# 预期：列出包含 checkPermissions 的文件和行号
```

## 6. NotebookEditTool

```bash
# 创建测试 notebook
cat > /tmp/test.ipynb << 'EOF'
{"cells":[{"cell_type":"code","source":["print('hello')"],"metadata":{},"outputs":[],"execution_count":null}],"metadata":{"kernelspec":{"display_name":"Python 3","language":"python","name":"python3"}},"nbformat":4,"nbformat_minor":5}
EOF

# 编辑 notebook
echo '把 /tmp/test.ipynb 第一个 cell 的内容改成 print("edited by AI")' | npx tsx src/cli.ts -p
# 验证：python3 -c "import json; print(json.load(open('/tmp/test.ipynb'))['cells'][0]['source'])"

# 清理
rm /tmp/test.ipynb
```

## 7. WebFetchTool

```bash
# 抓取网页
echo "访问 https://httpbin.org/get 并告诉我返回了什么" | npx tsx src/cli.ts -p
# 预期：显示 JSON 响应内容
```

## 8. ToolSearchTool（Deferred Loading）

```bash
# 搜索工具
echo "用 ToolSearch 搜索 pdf 相关工具" | npx tsx src/cli.ts -p
# 预期：找到 PDFRead 工具，显示其 schema

echo "用 ToolSearch 搜索 image 相关工具" | npx tsx src/cli.ts -p
# 预期：找到 ImageRead 工具
```

## 9. TodoWriteTool

```bash
echo "创建一个3步的 TODO 列表来初始化 Node.js 项目" | npx tsx src/cli.ts -p
# 预期：输出包含 3 个 TODO 项的列表
```

## 10. Skill 系统

```bash
# 创建测试 skill
mkdir -p .blino/skills
cat > .blino/skills/greet.md << 'EOF'
---
name: greet
description: 生成问候语
allowedTools: [Bash]
---
请用 echo 命令输出一句友好的问候语。
EOF

# 列出 skills
echo "调用 Skill 工具列出所有可用的 skill" | npx tsx src/cli.ts -p
# 预期：显示 greet skill

# 执行 skill
echo "执行 greet skill" | npx tsx src/cli.ts -p
# 预期：通过 Bash 输出问候语

# 清理
rm -rf .blino/skills
```

## 11. AgentTool（子 Agent）

```bash
echo "用 Agent 工具派生一个子 agent，让它读取 package.json 并告诉你项目名称" | npx tsx src/cli.ts -p
# 预期：子 agent 独立执行 FileRead，返回项目名称
```

## 12. 权限系统

```bash
# 默认模式下（非 pipe），写操作需要确认
# 在交互模式中测试：
npx tsx src/cli.ts
# 输入: 创建一个文件 /tmp/test-perm.txt
# 预期：弹出权限确认（y/n/a）
# 选择 a (always allow) → 后续同类操作自动通过

# bypass 模式
echo "创建 /tmp/test-bypass.txt" | npx tsx src/cli.ts -p --bypass-permissions
# 预期：直接通过，不需要确认
```

## 13. 上下文压缩（/compact）

```bash
# 在交互模式中测试
npx tsx src/cli.ts
# 多轮对话后：
# 输入: /status     → 查看当前 token 数
# 输入: /compact    → 手动压缩
# 输入: /status     → 确认 token 数减少
```

## 14. 文件快照（/undo）

```bash
# 在交互模式中测试
npx tsx src/cli.ts
# 输入: 创建文件 /tmp/undo-test.txt 内容为 "original"
# 输入: 把 /tmp/undo-test.txt 改成 "modified"
# 输入: /undo       → 列出可回滚文件
# 输入: /undo /tmp/undo-test.txt → 回滚
# 验证: cat /tmp/undo-test.txt → "original"
```

## 15. MCP 集成

```bash
# 配置 MCP 服务器
mkdir -p .blino
cat > .blino/settings.json << 'EOF'
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}
EOF

# 启动（应显示 MCP 连接信息）
npx tsx src/cli.ts
# 预期：启动时显示 "MCP: Connected to filesystem (N tools)"
# 输入: 用 ToolSearch 搜索 filesystem 相关工具
# 预期：显示 MCP 提供的工具列表

# 清理
rm .blino/settings.json
```

## 16. Coordinator 模式

```bash
echo "帮我了解项目结构：分别查看 src/engine/ 和 src/tools/ 的内容" | npx tsx src/cli.ts -p --coordinator
# 预期：Coordinator 派生 Workers 并行调查两个目录，然后综合分析
```

## 17. Context Providers

```bash
# CLAUDE.md 注入测试
echo "# 项目规则\n请始终用中文回答。" > CLAUDE.md
echo "你好" | npx tsx src/cli.ts -p
# 预期：应该用中文回答（因为 CLAUDE.md 有指令）
rm CLAUDE.md

# Git Context 测试（在 git 仓库内）
cd /some/git/repo
echo "告诉我当前的 git 状态" | npx tsx src/cli.ts -p
# 预期：模型知道当前分支和状态（通过 GitContextProvider 注入到 system prompt）
```

## 18. API Provider 切换

```bash
# Anthropic 兼容
ANTHROPIC_API_KEY=xxx ANTHROPIC_BASE_URL=xxx npx tsx src/cli.ts
# 自动检测为 anthropic provider

# OpenAI 兼容
OPENAI_API_KEY=xxx OPENAI_BASE_URL=xxx npx tsx src/cli.ts
# 自动检测为 openai provider

# 显式指定
npx tsx src/cli.ts --provider openai --api-key xxx --base-url xxx
```

## 19. 错误恢复

```bash
# max_output_tokens 恢复（AI 输出过长时自动续写）
echo "请详细列出 Linux 系统中所有常用命令及其用法（至少100个）" | npx tsx src/cli.ts -p
# 预期：如果输出被截断，自动发送恢复消息请求续写

# 模型降级（需要配置 FALLBACK_MODEL）
FALLBACK_MODEL=claude-3-haiku-20240307 npx tsx src/cli.ts
# 当主模型 503 时自动切换到 fallback 模型
```

## 20. Transcript 持久化

```bash
# 对话后检查 transcript 文件
npx tsx src/cli.ts
# 进行一些对话后退出

ls ~/.blino/projects/*/
# 预期：看到 .jsonl 文件
# 文件内容：每行一个 JSON 对象，包含 timestamp/role/content
```

---

## 测试环境要求

- Node.js >= 18（推荐 >= 20）
- 可用的 Anthropic 或 OpenAI 兼容 API
- ripgrep (`rg`) 已安装（GrepTool 优先使用，fallback 到 grep）
- Git（GitContextProvider 需要）
