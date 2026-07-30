# EasyDashboard

<div align="center">

[English](./README.md) | 简体中文

</div>

EasyDashboard 是基于
[EasyEditor](https://github.com/Easy-Editor/EasyEditor) 低代码引擎构建的个人数据大屏工作区。仓库包含 React 编辑器、Hono API，以及独立部署且不携带 Cookie 的公开 Viewer。

<div align="center">
  <img src=".github/assets/page.png" width="1000" alt="EasyDashboard 编辑器" />
</div>

## 当前能力

- 在服务端自动创建的个人空间中，新建、搜索、收藏、复制、移入回收站和恢复项目。
- 通过拖拽编辑、属性配置、JSON Schema 编辑、页面排序和起始页设置构建多页面大屏。
- 使用乐观并发控制将草稿保存到 PostgreSQL；项目文档不会持久化到 LocalStorage。
- 创建手动恢复点，保留周期性自动恢复点，并在不删除既有历史的前提下恢复旧版本。
- 自动生成项目缩略图，或通过 Supabase Storage 私有存储桶和签名 URL 上传自定义缩略图。
- 将已保存草稿发布为稳定 Viewer 链接和基于不可变发布快照的版本链接。
- 支持邮箱密码、GitHub 和 Google 登录；Hono API 将 Supabase 会话保存在安全的 Host-only Cookie 中。

Agent 执行、模板产品流程、团队协作和 3D 编辑不属于当前应用能力。

## Workspace 结构

本仓库使用 pnpm workspace：

```text
EasyDashboard/
├── api/                     # Vercel Function 薄适配层
├── server/                  # 可移植 Hono API 与本地 Node 适配层
├── src/                     # 需要登录的 React 应用和编辑器
├── supabase/migrations/     # 按顺序执行的数据库与存储迁移
├── viewer/                  # 独立、无 Cookie 的公开 Viewer
└── pnpm-workspace.yaml
```

## 环境要求

- Node.js 22.x（CI 的准确版本记录在 `.node-version`）
- pnpm 10.28.2
- 用于运行本地 Supabase 的 Docker
- 每个线上环境使用独立的 Supabase 项目

## 本地开发

1. 安装 workspace 依赖：

   ```bash
   pnpm install --frozen-lockfile
   ```

2. 使用仓库锁定版本的 Supabase CLI 启动本地服务：

   ```bash
   pnpm exec supabase start
   pnpm exec supabase status -o env \
     --override-name api.url=SUPABASE_URL,auth.publishable_key=SUPABASE_PUBLISHABLE_KEY
   ```

   全新本地实例会自动执行 `supabase/roles.sql` 和全部迁移。
   `roles.sql` 中的运行时密码只允许用于本地与 CI；线上环境必须单独生成强随机密码。
   如果现有本地实例已经有开发数据，不要为了更新角色而执行
   `supabase db reset`，可在不删除数据的情况下单独执行本地角色文件：

   ```bash
   pnpm exec supabase db query --local --file supabase/roles.sql
   ```

3. 参考 [`.env.example`](./.env.example) 创建 `.env`，填入
   `supabase status` 输出的本地值，并使用以下地址：

   ```text
   APP_ORIGIN=http://127.0.0.1:5173
   PUBLIC_VIEWER_ORIGIN=http://view.localhost:5174
   PORT=8787
   VITE_PUBLIC_VIEWER_ORIGIN=http://view.localhost:5174
   VITE_PUBLIC_API_ORIGIN=http://127.0.0.1:5173
   SUPABASE_URL=<supabase status 输出的 SUPABASE_URL>
   SUPABASE_PUBLISHABLE_KEY=<supabase status 输出的 SUPABASE_PUBLISHABLE_KEY>
   DATABASE_URL=postgresql://easy_dashboard_runtime:easy_dashboard_ci_local_only@127.0.0.1:54322/postgres
   ```

   浏览器统一通过应用同源的 `/api` 路径访问 API，Vite 再将请求代理到
   `8787` 端口上的 Hono 开发服务。

4. 启动三个开发进程：

   ```bash
   pnpm dev
   ```

登录应用地址为 `http://127.0.0.1:5173`，公开 Viewer 地址为
`http://view.localhost:5174`。

## 本地验证

首次运行前安装 Chromium，然后执行产品闭环浏览器测试：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

测试会创建名称唯一的本地 E2E 账户和项目，并在结束时永久删除测试项目，
不要求重置开发数据。

## 常用脚本

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 同时启动应用、Viewer 和 API |
| `pnpm dev:web` | 仅启动登录应用 |
| `pnpm dev:viewer` | 仅启动公开 Viewer |
| `pnpm dev:server` | 仅启动 Hono API |
| `pnpm build` | 构建应用、Viewer 和服务端 |
| `pnpm typecheck` | 对三个 workspace 应用执行类型检查 |
| `pnpm test` | 运行 Web、公开 Viewer 与服务端测试 |
| `pnpm test:e2e` | 运行 Chromium 产品闭环测试 |
| `pnpm test:e2e:ui` | 打开 Playwright 测试界面 |
| `pnpm lint` | 执行 Biome 检查 |
| `pnpm format` | 使用 Biome 格式化 workspace |

## 架构与部署

- [架构说明](./docs/ARCHITECTURE.md)
- [产品设计](./docs/PRODUCT-DESIGN.md)
- [Supabase 与 Vercel 部署](./docs/DEPLOYMENT.md)
- [远程物料](./docs/remote-materials.md)

## 贡献

欢迎贡献。请提交范围明确的 Issue 或 Pull Request，并附带验证结果。

## 许可证

[MIT](./LICENSE) License &copy; 2024-PRESENT
[JinSo](https://github.com/JinSooo)
