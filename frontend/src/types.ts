export interface Conversation {
  id: number
  title: string
  messages?: string
  created_at: string
  updated_at: string
}

export interface AiModelCapabilities {
  multimodal?: boolean
  deep_thinking?: boolean
  tool_calling?: boolean
  function_calling?: boolean
  [key: string]: boolean | undefined
}

export interface AiModel {
  id: number
  model_name: string
  display_name: string
  provider: string
  capabilities: AiModelCapabilities
  enabled: 'Y' | 'N'
}

export interface ModelProvider {
  id?: number
  name: string
  label?: string
  base_url: string
  api_key: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
