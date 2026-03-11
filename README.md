# last-version-ppt

基于 `zelixir/terminal-agent` 框架迁移而来的本地 AI 应用骨架。

当前版本已经移除终端 / SSH / 命令审批相关工具，保留以下能力：

- Bun + Elysia 后端框架
- React + Vite + Tailwind 前端框架
- SQLite 本地存储
- AI 服务商管理
- AI 模型管理
- 通用聊天页面
- 对话历史持久化
- SQLite MCP 工具
- Bun 单文件打包脚本

## 开发

安装依赖：

```bash
bun run install:all
```

启动开发环境：

```bash
bun run dev
```

前端默认通过 Vite 访问，后端运行在 `http://localhost:3101`。

## 发布 Windows EXE

仓库提供了一个 GitHub Actions 手动工作流：进入 Actions，运行“发布 Windows 可执行文件”，输入版本号后即可构建 exe 并发布到对应的 GitHub Release。

## 说明

这次迁移的目标是“保留框架，移除终端相关工具”。因此：

- 已删除 SSH 终端连接、xterm、命令自动审批等能力
- 已保留原有的项目结构、UI 组件、SQLite 与模型配置框架
- 后续可以在此基础上继续扩展 PPT 生成或其他 AI 业务功能
