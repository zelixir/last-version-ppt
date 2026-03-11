# last-version-ppt


## 需求
使用ai来创建ppt
基于[pptxgenjs](https://github.com/gitbrent/PptxGenJS)
文档: https://gitbrent.github.io/PptxGenJS/docs/introduction/

基础框架直接使用这个项目
https://github.com/zelixir/terminal-agent


只需支持win10以上, 最新版chrome即可

储存目录: %appdata%/last-version-ppt

每个项目使用一个文件夹, 命名规则: yyyyMMdd_<name>, 这也是项目id

项目目录下至少有一个index.js
此文件为ai生成, 由框架调用, 传入pptxgenjs, 用于创建ppt
其他文件为用户上传的图片或文本文件

## 软件流程

1. 应用启动后, 监听http服务, 并调用系统浏览器打开主页
2. 主页顶部显示一个对话框, 下面显示项目列表
   用户可以点击项目列表中的项目, 进入对应项目(使用项目id作为url参数)
   对话框placeholder随机显示几个需求
   用户通过对话框输入需求提交之后, 调用ai为项目起名
   然后创建项目, 并进入项目, 然后自动提交需求

   主页还需要有一个进入模型配置页面的按钮
   参考terminal-agent, 项目初始化时自动配置一些默认模型
   但是如果模型提供商的apikey是默认的stub, 则该按钮需要高亮, 并提示用户需要配置模型
   模型配置保存在储存目录, 以sqlite数据库的形式
3. 项目主页, 左边为预览区域, 有 ppt预览 和 资源管理 2个tab
   默认为ppt预览(就像在PowerPoint中打开ppt一样, 左边缩略图, 右边当前页预览)
   资源管理同样分2个区域, 左边为文件列表, 右边预览当前文件(仅支持媒体和文本文件预览)
   使用monaco编辑器预览和编辑文本
   index.js也视为资源
   用户可以拖入文件或点击上传按钮来上传文件, 提供"打开资源管理器"按钮, 调用explorer打开项目储存文件夹
   可以按del删除文件, 但是不能删除index.js
   默认隐藏index.js, 提供一个勾选框, 显示ai生成的源代码

   右边为ai对话栏, 用户通过对话的方式, 让ai生成或编辑index.js

   ppt预览区域, 提供 刷新, 导出ppt 这2个按钮
   刷新按钮重新运行index.js, 导出ppt则生成ppt并发送到浏览器下载
   如果运行index.js报错, 则预览区域显示报错内容(需要有大字: 出错啦)

## AI agent构建

agent提供以下工具

### 项目工具
- create-project
- clone-project
- switch-project
- create-version
  将当前项目复制一份, 项目id变为 yyyyMMdd_<name>_vv
  vv是2位递增数字
  如果当前项目已经有版本号, 则使用原始项目的最新版本号+1
  clone-project会有一个新的name和yyyyMMdd, 而create-version使用原始项目的yyyyMMdd_<name>
- get-current-project
- run-project
  运行index.js, 并返回成功或者报错详情
  成功运行则切换到ppt预览
  可以指定是否返回index.js的日志(框架提供日志接口)

### 文件工具
文件工具仅支持读写当前项目下的工具

- list-file
- create-file
- rename-file
- delete-file
- grep

### 代码工具
- apply-patch
  使用 https://github.com/microsoft/vscode-copilot-chat 中的算法逻辑

### agent上下文

系统prompt包含: agent角色, pptxgenjs文档, index.js的结构(框架环境信息)

你需要阅读 https://gitbrent.github.io/PptxGenJS/docs/introduction/
并提炼出一份pptxgenjs的使用文档
  


agent的所有工具渲染必须使用用户友好的方式
不允许直接渲染json
工具渲染只需要渲染工具名, 文件名, 结果数量, 意图 等简短信息, 避免冗长

## 项目框架
后端通过 /<project_id>/filename 的方式提供http资源
前端创建一个环境, 在这个环境下运行/<project_id>/index.js
环境需要支持以下接口:
- 访问pptxgenjs
- 通过名称获取项目资源的http链接
- 写出日志

index.js仅提供内容, 至于内容用于预览还是导出ppt文件, 由调用方决定


