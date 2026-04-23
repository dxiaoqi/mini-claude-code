# Blino 本地测试工作区

在此目录中配置 **API 与 .blino**。启动 `blino` 时**工作目录需为本目录**（`playground/blino-smoke`），这样才会读取这里的 `.blino`。

## 1. 配置密钥

```bash
cd playground/blino-smoke
cp .blino/settings.json.example .blino/settings.json
# 编辑 .blino/settings.json，填入你的 API Key 与 baseUrl
```

- `settings.json` 与 `settings.local.json` 已在仓库根 `.gitignore` 中忽略，勿提交真密钥。  
- 也可只用 `settings.local.json` 覆盖项目级配置（需自行从 example 复制改名）。

## 2. 启动 Agent（cwd = 本目录）

在**仓库外或仓库内**均可，但进程启动时的 **当前目录必须是 `.../playground/blino-smoke`**：

```bash
cd /path/to/<repo>/playground/blino-smoke
# 开发：仓库根有 node_modules 时
npx tsx ../../src/cli.ts --serve --port 3001 --cors-origin http://localhost:3000
# 或先 在仓库根 执行 npm run build，再在本目录：
node ../../dist/cli.js --serve --port 3001 --cors-origin http://localhost:3000
# 注意：必须在本目录（blino-smoke）执行，cwd 才会读到这里的 .blino。
```

若你从仓库根起 `node dist/cli.js`，会读仓库根的 `.blino`，**不会**用本测试目录。务必 **`cd` 到 `playground/blino-smoke` 再执行**。

## 3. 启动 Web UI

```bash
cd ui
# .env.local: NEXT_PUBLIC_BLINO_URL=http://localhost:3001
npm run dev -- --port 3000
```

打开 `http://localhost:3000`，先在聊天里**发一条消息**建立 session，再点 **「项目」** 看路径、两阶段、技能列表、重载 等。

## 4. 本目录内容

| 文件 | 说明 |
|------|------|
| `.blino/settings.json.example` | 复制为 `settings.json` 后填密钥 |
| `.blino/workflow.json` | 两阶段 + `demo-a` / `demo-b` 两个 pack |
| `.blino/skills/demo-a/hello.md` | 阶段 1 可见 |
| `.blino/skills/demo-b/hello.md` | 阶段 2 可见（用「项目」里阶段切换） |

## 5. 故障排查

- **CORS**：`--cors-origin` 与浏览器源一致，例如 `http://localhost:3000`。  
- **读错配置**：用「项目」侧栏顶部显示的 `cwd` 是否指向 `.../playground/blino-smoke`。  
- **项目面板灰掉**：无 session 时先聊一句再开「项目」。
