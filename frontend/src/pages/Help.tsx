import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BrainCircuit, Building2, Database, MessageSquare, Rocket, Sparkles } from 'lucide-react'
import { Button } from '../components/ui/button'

interface StepProps {
  number: number
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}

function Step({ number, icon, title, children }: StepProps) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-shrink-0 flex-col items-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">{number}</div>
        <div className="mt-2 w-px flex-1 bg-gray-700" />
      </div>
      <div className="pb-8">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-blue-400">{icon}</span>
          <h3 className="text-base font-semibold text-white">{title}</h3>
        </div>
        <div className="space-y-2 text-sm leading-relaxed text-gray-400">{children}</div>
      </div>
    </div>
  )
}

function Code({ children }: { children: string }) {
  return <code className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-xs text-green-300">{children}</code>
}

export default function Help() {
  const navigate = useNavigate()

  return (
    <div className="h-screen overflow-y-auto bg-gray-950">
      <div className="p-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}><ArrowLeft className="h-4 w-4" /></Button>
            <Sparkles className="h-7 w-7 text-blue-400" />
            <h1 className="text-xl font-bold text-white">使用帮助</h1>
          </div>

          <p className="mb-8 text-sm leading-relaxed text-gray-400">当前项目已经迁移了 terminal-agent 的整体框架，但移除了终端 / SSH / 命令审批等能力，保留为一个本地运行的通用 AI 聊天与配置平台。</p>

          <div>
            <Step number={1} icon={<Building2 className="h-4 w-4" />} title="配置 AI 服务商">
              <p>首页的 <strong className="text-gray-200">「服务商」</strong> 标签页用于维护 OpenAI 兼容接口。</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li><strong className="text-gray-200">服务商标识</strong>：如 <Code>openai</Code>、<Code>dashscope</Code></li>
                <li><strong className="text-gray-200">显示名称</strong>：用于界面展示</li>
                <li><strong className="text-gray-200">Base URL</strong>：如 <Code>https://api.openai.com/v1</Code></li>
                <li><strong className="text-gray-200">API Key</strong>：仅保存在本地数据库中</li>
              </ul>
            </Step>

            <Step number={2} icon={<BrainCircuit className="h-4 w-4" />} title="添加并启用模型">
              <p>在 <strong className="text-gray-200">「模型」</strong> 标签页中，把模型 ID 绑定到具体服务商。</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>填写服务商要求的模型名，例如 <Code>gpt-4o</Code> 或 <Code>qwen3-max</Code></li>
                <li>为模型设置友好显示名，方便在聊天页切换</li>
                <li>只有状态为 <strong className="text-gray-200">启用</strong> 的模型会出现在聊天页</li>
              </ul>
            </Step>

            <Step number={3} icon={<MessageSquare className="h-4 w-4" />} title="开始聊天">
              <p>进入聊天页后，选择一个已启用模型即可直接发送自然语言问题。</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>当前版本只保留模型调用和消息流转，不再执行终端命令</li>
                <li>每次成功对话都会自动保存到本地历史记录</li>
                <li>历史记录可随时重新打开，继续补充上下文</li>
              </ul>
            </Step>

            <Step number={4} icon={<Database className="h-4 w-4" />} title="本地数据与扩展">
              <p>所有配置与会话默认保存在本地 SQLite 文件 <Code>last-version-ppt.db</Code> 中。</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>后端保留了 SQLite MCP 服务，可继续作为后续功能扩展的基础</li>
                <li>前端 UI 组件、路由结构、构建脚本都已沿用 terminal-agent 的框架组织方式</li>
                <li>如果后续要加入 PPT 生成等能力，可以直接在当前框架上继续开发</li>
              </ul>
            </Step>
          </div>

          <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-6">
            <h2 className="mb-4 text-base font-semibold text-white">常见问题</h2>
            <div className="space-y-4 text-sm">
              <div>
                <p className="font-medium text-gray-200">为什么聊天页提示先配置 API Key？</p>
                <p className="mt-1 text-gray-400">如果服务商仍然使用示例 Key（如 <Code>your_dashscope_api_key_here</Code>），后端会阻止真实请求，避免误用无效配置。</p>
              </div>
              <div>
                <p className="font-medium text-gray-200">终端能力还在吗？</p>
                <p className="mt-1 text-gray-400">不在了。本次迁移明确移除了 SSH、终端流、命令审批以及相关工具调用逻辑。</p>
              </div>
              <div>
                <p className="font-medium text-gray-200">是否还能打包成单文件应用？</p>
                <p className="mt-1 text-gray-400">可以，项目仍保留 Bun 打包脚本，后续可继续生成包含前后端资源的可执行文件。</p>
              </div>
            </div>
          </div>

          <div className="mt-6 text-center">
            <Button variant="default" onClick={() => navigate('/chat')}><Rocket className="h-4 w-4" />进入聊天</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
