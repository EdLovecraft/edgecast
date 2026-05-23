# EdgeCast

EdgeCast 是一个运行在 Cloudflare Workers 上的浏览器屏幕共享应用。分享者创建房间后，可以直接在浏览器中共享屏幕、系统音频和麦克风；观看者打开房间链接即可观看，不需要安装额外软件。

English documentation: [README.en.md](README.en.md)

## 功能

- 浏览器内发起屏幕共享。
- 支持屏幕音频和麦克风采集。
- 分享过程中可开关麦克风。
- 房间名和房间链接支持一键复制。
- 使用 Cloudflare Workers + Durable Objects 处理房间和 WebSocket 信令。

## 环境要求

- Node.js 和 npm。
- Cloudflare 账号。
- Wrangler：项目已作为开发依赖配置，执行 `npm install` 后可通过 `npx wrangler` 使用。

项目主要 npm 依赖：

- `lucide`：界面图标。
- `vite`：前端构建。
- `typescript`：类型检查和编译。
- `wrangler`：Cloudflare Workers 构建与发布工具。
- `@cloudflare/workers-types`：Cloudflare Workers 类型定义。

## 部署

先安装依赖：

```bash
npm install
```

登录 Cloudflare：

```bash
npx wrangler login
```

发布到 Cloudflare Workers：

```bash
npm run deploy
```

## 协议

本项目基于 MIT License 发布。完整协议见 [LICENSE](LICENSE)，版权和声明信息见 [NOTICE](NOTICE)。
