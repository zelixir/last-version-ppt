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

export interface ProjectFile {
  name: string
  size: number
  updatedAt: string
  kind: 'text' | 'image' | 'media' | 'binary'
  url: string
}

export interface ToolEvent {
  toolName: string
  summary: string
  success: boolean
}

export interface ProjectChatMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  toolEvents?: ToolEvent[]
}

export interface ProjectSummary {
  id: string
  name: string
  rootProjectId: string
  sourcePrompt: string
  createdAt: string
  updatedAt: string
  files: ProjectFile[]
  chatHistory: ProjectChatMessage[]
  projectDir: string
}

export interface ConfigStatus {
  hasStubProviders: boolean
  hasEnabledModels: boolean
  hasUsableModel: boolean
  needsAttention: boolean
  firstUsableModelId: number | null
}

export interface PreviewTextElement {
  kind: 'text'
  x: number
  y: number
  w: number
  h: number
  text: string
  color?: string
  fontSize?: number
  bold?: boolean
  align?: string
  valign?: string
  fillColor?: string
  borderColor?: string
}

export interface PreviewShapeElement {
  kind: 'shape'
  x: number
  y: number
  w: number
  h: number
  fillColor?: string
  borderColor?: string
  shape?: string
}

export interface PreviewImageElement {
  kind: 'image'
  x: number
  y: number
  w: number
  h: number
  src: string
}

export interface PreviewTableElement {
  kind: 'table'
  x: number
  y: number
  w: number
  h: number
  rows: string[][]
}

export type PreviewElement = PreviewTextElement | PreviewShapeElement | PreviewImageElement | PreviewTableElement

export interface PreviewSlide {
  id: string
  backgroundColor?: string
  elements: PreviewElement[]
}

export interface PreviewPresentation {
  width: number
  height: number
  slides: PreviewSlide[]
  logs: string[]
}
