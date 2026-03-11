import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BrainCircuit, FileCode2, FolderOpen, LayoutTemplate, Sparkles } from 'lucide-react'
import { Button } from '../components/ui/button'

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-5">
      <div className="mb-3 flex items-center gap-2 text-white"><span className="text-blue-400">{icon}</span><h2 className="text-lg font-semibold">{title}</h2></div>
      <div className="space-y-2 text-sm leading-relaxed text-gray-400">{children}</div>
    </div>
  )
}

export default function Help() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-gray-950 p-6 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}><ArrowLeft className="h-4 w-4" /></Button>
          <Sparkles className="h-7 w-7 text-blue-400" />
          <h1 className="text-2xl font-bold text-white">使用帮助</h1>
        </div>

        <Section icon={<BrainCircuit className="h-4 w-4" />} title="1. 先配置模型">
          <p>从首页右上角进入模型配置页，为至少一个服务商填入真实 API Key，并启用一个支持工具调用的模型。</p>
          <p>如果仍使用示例 stub key，首页的“模型配置”按钮会高亮提醒，项目创建与 AI 对话也会被阻止。</p>
        </Section>

        <Section icon={<LayoutTemplate className="h-4 w-4" />} title="2. 从需求直接创建项目">
          <p>首页顶部输入你对 PPT 的需求后，系统会调用 AI 自动为项目命名，并创建形如 <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-green-300">yyyyMMdd_name</code> 的项目目录。</p>
          <p>创建完成后会自动进入项目页，并把这段需求立即提交给右侧 AI agent。</p>
        </Section>

        <Section icon={<FileCode2 className="h-4 w-4" />} title="3. 项目页的工作方式">
          <p>左侧有两个标签：<strong className="text-gray-200">PPT 预览</strong> 和 <strong className="text-gray-200">资源管理</strong>。</p>
          <p>PPT 预览支持刷新与导出；资源管理支持上传、查看、编辑文本文件，默认隐藏 <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-green-300">index.js</code>，勾选后可直接编辑。</p>
          <p>右侧 AI 对话会调用项目工具、文件工具和代码补丁工具，帮助你生成或修改 <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-green-300">index.js</code>。</p>
        </Section>

        <Section icon={<FolderOpen className="h-4 w-4" />} title="4. 资源与 index.js">
          <p>所有项目资源都保存在本地存储目录下的对应项目文件夹中，后端会通过 <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-green-300">/&lt;project_id&gt;/filename</code> 暴露给浏览器使用。</p>
          <p>在 <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-green-300">index.js</code> 中，请通过 <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-green-300">getResourceUrl('文件名')</code> 引用已上传的图片或媒体资源。</p>
        </Section>
      </div>
    </div>
  )
}
