# last-version-ppt

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

如果你想单独检查“预览页转图片”这条链路，可以在开发环境里打开：

```text
http://localhost:5173/preview-image-test.html?projectId=你的项目编号
```

页面会直接读取项目脚本，先在浏览器里排版，再把每一页转成预览图，方便确认预览功能是否正常。

如果你想用 Puppeteer 自动跑完整条链路、把中文预览图和排查日志都保存下来，可以运行：

```bash
bun run test:render
```

脚本会自动：

- 构建前端页面
- 启动本地后端
- 新建一个带中文内容的测试项目
- 打开“预览出图测试”页面并触发出图
- 把生成出来的第一页图片、页面截图和日志文件保存到临时目录

如果你希望把文件存到指定位置，可以这样运行：

```bash
bun run scripts/puppeteer-render-test.ts --output-dir 你的目录
```

## 发布 Windows EXE

仓库提供了一个 GitHub Actions 手动工作流：进入 Actions，运行“发布 Windows 可执行文件”，输入版本号后即可构建 exe 并发布到对应的 GitHub Release。

## 说明

这次迁移的目标是“保留框架，移除终端相关工具”。因此：

- 已删除 SSH 终端连接、xterm、命令自动审批等能力
- 已保留原有的项目结构、UI 组件、SQLite 与模型配置框架
- 后续可以在此基础上继续扩展 PPT 生成或其他 AI 业务功能
