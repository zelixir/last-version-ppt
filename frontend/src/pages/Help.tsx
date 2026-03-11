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
          <p>从首页右上角进入模型配置页，为至少一个模型服务填入可用的接口密钥，并启用一个模型。</p>
          <p>如果仍在使用尚未配置模型服务的 API Key，首页的“模型配置”按钮会高亮提醒，创建项目和继续完善演示稿都会被阻止。</p>
        </Section>

        <Section icon={<LayoutTemplate className="h-4 w-4" />} title="2. 从需求直接创建项目">
          <p>首页顶部输入你对 PPT 的需求后，系统会自动帮你命名，并创建形如 <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-green-300">yyyyMMdd_name</code> 的项目目录。</p>
          <p>创建完成后会自动进入项目页，并把这段需求立即交给右侧的智能助手开始生成与编辑 PPT。</p>
        </Section>

        <Section icon={<FileCode2 className="h-4 w-4" />} title="3. 项目页怎么使用">
          <p>左侧有两个标签：<strong className="text-gray-200">PPT 预览</strong> 和 <strong className="text-gray-200">资源管理</strong>。</p>
          <p>PPT 预览支持刷新与导出；资源管理支持上传、查看、编辑文本文件。默认会隐藏 <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-green-300">index.js</code>，勾选后也可以直接编辑。</p>
          <p>右侧的智能助手会帮你生成或修改 PPT 脚本，让预览内容跟着你的需求继续变化。</p>
        </Section>

        <Section icon={<FolderOpen className="h-4 w-4" />} title="4. 资源和 PPT 脚本">
          <p>所有项目资源都会保存在本地存储目录下的项目文件夹中。你上传的图片、音频、视频或文本，都会留在这个项目里。</p>
          <p>如果你需要更细致地调整内容，也可以显示并编辑 <code className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-green-300">index.js</code>。这个文件就是当前演示稿的制作脚本。</p>
        </Section>
      </div>
    </div>
  )
}
