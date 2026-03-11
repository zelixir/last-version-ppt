# last-version-ppt

基于 AI 和 [PptxGenJS](https://github.com/gitbrent/PptxGenJS) 的本地 PPT 生成器。

## 当前实现

- 本地 Web 界面，建议在 Win10 及以上系统中使用最新版 Chrome
- 使用 OpenAI 兼容接口生成 PPT 大纲
- 使用 PptxGenJS 在本地生成 `.pptx`
- 数据与项目默认保存到 `%appdata%/last-version-ppt`
- 每次生成都会创建一个项目目录，目录名以 `yyyyMMdd_` 开头

## 启动

```bash
npm install
npm run dev
```

启动后访问：

```text
http://127.0.0.1:3000
```

## 可用脚本

```bash
npm run build
npm test
```
