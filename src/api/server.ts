import { getDesktopBridge, type DesktopBridge } from '../desktop/bridge'

export type BillingModelKind = 'text' | 'image' | 'video'

export type ProfileKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_prompt'
  | 'image_to_video'
  | 'text_to_video'
  | 'image_edit'

export type ModelCatalogVendorAuthType = 'none' | 'bearer' | 'x-api-key' | 'query'
export type ModelCatalogVendorProviderKind = 'openai-compatible' | 'anthropic'

export type ModelCatalogIntegrationChannelKind =
  | 'official_provider'
  | 'aggregator_gateway'
  | 'private_proxy'
  | 'local_runtime'
  | 'custom_endpoint'

export type AgentsChatRequestDto = {
  vendor?: string
  prompt: string
  displayPrompt?: string
  sessionKey?: string
  canvasProjectId?: string
  canvasFlowId?: string
  chatContext?: unknown
  mode?: 'chat' | 'auto' | string
  temperature?: number
  systemPrompt?: string
}

export type AgentsChatResponseDto = {
  id?: string
  text: string
  raw?: unknown
  toolCalls?: unknown[]
  artifacts?: unknown[]
}

export type AgentsChatToolStreamPayload = Record<string, unknown>

export type AgentsChatStreamEvent =
  | { event: 'initial'; data: { requestId: string; messageId?: string } }
  | { event: 'content'; data: { delta: string; text: string } }
  | { event: 'tool'; data: AgentsChatToolStreamPayload }
  | { event: 'result'; data: { response: AgentsChatResponseDto } }
  | { event: 'error'; data: { message: string; code?: string } }
  | { event: 'done'; data: { reason: 'finished' | 'error' } }
  | { event: string; data: Record<string, unknown> }

export type ModelCatalogVendorDto = {
  key: string
  name: string
  enabled: boolean
  hasApiKey?: boolean
  baseUrlHint?: string | null
  authType?: ModelCatalogVendorAuthType
  authHeader?: string | null
  authQueryParam?: string | null
  providerKind?: ModelCatalogVendorProviderKind
  meta?: unknown
  createdAt: string
  updatedAt: string
}

export type ModelCatalogModelDto = {
  modelKey: string
  vendorKey: string
  modelAlias?: string | null
  labelZh: string
  kind: BillingModelKind
  enabled: boolean
  meta?: unknown
  pricing?: {
    cost: number
    enabled: boolean
    createdAt?: string
    updatedAt?: string
    specCosts: Array<{
      specKey: string
      cost: number
      enabled: boolean
      createdAt?: string
      updatedAt?: string
    }>
  }
  createdAt: string
  updatedAt: string
}

export type ModelCatalogMappingDto = {
  id: string
  vendorKey: string
  taskKind: ProfileKind
  name: string
  enabled: boolean
  requestMapping?: unknown
  responseMapping?: unknown
  createdAt: string
  updatedAt: string
}

export type ModelCatalogVendorApiKeyStatusDto = {
  vendorKey: string
  hasApiKey: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type ModelCatalogImportPackageDto = {
  version: string
  exportedAt?: string
  vendors: Array<{
    vendor: {
      key: string
      name: string
      enabled?: boolean
      baseUrlHint?: string | null
      authType?: ModelCatalogVendorAuthType
      authHeader?: string | null
      authQueryParam?: string | null
      meta?: unknown
    }
    apiKey?: {
      apiKey?: string
      enabled?: boolean
    }
    models?: Array<{
      modelKey: string
      vendorKey?: string
      modelAlias?: string | null
      labelZh: string
      kind: BillingModelKind
      enabled?: boolean
      meta?: unknown
      pricing?: ModelCatalogModelDto['pricing']
    }>
    mappings?: Array<{
      id?: string
      vendorKey?: string
      taskKind: ProfileKind
      name: string
      enabled?: boolean
      requestProfile?: unknown
      requestMapping?: unknown
      responseMapping?: unknown
    }>
  }>
}

export type ModelCatalogImportResultDto = {
  imported: {
    vendors: number
    models: number
    mappings: number
  }
  errors: string[]
}

export type ModelCatalogDocsFetchResultDto = {
  url: string
  finalUrl: string
  status: number
  contentType: string
  title: string | null
  text: string
  truncated: boolean
  diagnostics: string[]
}

export type ModelCatalogMappingTestRequestDto = {
  modelKey?: string
  prompt?: string
  stage?: 'create' | 'query' | string
  execute?: boolean
}

export type ModelCatalogMappingTestResultDto = {
  mappingId: string
  vendorKey: string
  taskKind: ProfileKind
  stage: string
  executed: boolean
  ok: boolean
  diagnostics: string[]
  request: unknown
  response?: unknown
}

function requireDesktopRuntime(feature: string): DesktopBridge {
  const desktop = getDesktopBridge()
  if (!desktop) throw new Error(`${feature} requires the Electron desktop runtime`)
  return desktop
}

function createDesktopAgentResponse(raw: unknown): AgentsChatResponseDto {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    id: typeof record.id === 'string' ? record.id : `agent-${Date.now()}`,
    text: typeof record.text === 'string' ? record.text : '',
    raw: record.raw ?? raw,
    toolCalls: Array.isArray(record.toolCalls) ? record.toolCalls : [],
    artifacts: Array.isArray(record.artifacts) ? record.artifacts : [],
  }
}

async function openDesktopAgentsChatStream(
  payload: AgentsChatRequestDto,
  handlers: {
    onEvent: (event: AgentsChatStreamEvent) => void
    onOpen?: () => void
    onError?: (error: Error) => void
  },
): Promise<() => void> {
  const desktop = requireDesktopRuntime('agents chat')
  let aborted = false
  const requestId = `desktop-${Date.now()}`
  const messageId = `message-${Date.now()}`
  handlers.onOpen?.()
  handlers.onEvent({ event: 'initial', data: { requestId, messageId } })

  void desktop.agents.chat(payload).then((rawResponse) => {
    if (aborted) return
    const response = createDesktopAgentResponse(rawResponse)
    if (response.text) {
      handlers.onEvent({ event: 'content', data: { delta: response.text, text: response.text } })
    }
    handlers.onEvent({ event: 'result', data: { response } })
    handlers.onEvent({ event: 'done', data: { reason: 'finished' } })
  }).catch((error: unknown) => {
    if (aborted) return
    const err = error instanceof Error ? error : new Error(String(error))
    handlers.onError?.(err)
    handlers.onEvent({ event: 'error', data: { message: err.message } })
    handlers.onEvent({ event: 'done', data: { reason: 'error' } })
  })

  return () => {
    aborted = true
  }
}

export async function agentsChatStream(
  payload: AgentsChatRequestDto,
  handlers: {
    onEvent: (event: AgentsChatStreamEvent) => void
    onOpen?: () => void
    onError?: (error: Error) => void
  },
): Promise<() => void> {
  return openDesktopAgentsChatStream(payload, handlers)
}

export async function workbenchAgentsChatStream(
  payload: AgentsChatRequestDto,
  handlers: {
    onEvent: (event: AgentsChatStreamEvent) => void
    onOpen?: () => void
    onError?: (error: Error) => void
  },
): Promise<() => void> {
  return openDesktopAgentsChatStream(payload, handlers)
}

export async function agentsChat(payload: AgentsChatRequestDto): Promise<AgentsChatResponseDto> {
  return createDesktopAgentResponse(await requireDesktopRuntime('agents chat').agents.chat(payload))
}

export async function workbenchAgentsChat(payload: AgentsChatRequestDto): Promise<AgentsChatResponseDto> {
  return createDesktopAgentResponse(await requireDesktopRuntime('workbench agents chat').agents.chat(payload))
}

export async function listModelCatalogVendors(): Promise<ModelCatalogVendorDto[]> {
  return requireDesktopRuntime('model catalog').modelCatalog.listVendors() as ModelCatalogVendorDto[]
}

export async function listModelCatalogModels(params?: {
  vendorKey?: string
  kind?: BillingModelKind
  enabled?: boolean
}): Promise<ModelCatalogModelDto[]> {
  return requireDesktopRuntime('model catalog').modelCatalog.listModels(params) as ModelCatalogModelDto[]
}

export async function listModelCatalogMappings(params?: {
  vendorKey?: string
  taskKind?: ProfileKind
  enabled?: boolean
}): Promise<ModelCatalogMappingDto[]> {
  return requireDesktopRuntime('model catalog').modelCatalog.listMappings(params) as ModelCatalogMappingDto[]
}

export async function upsertModelCatalogVendor(
  payload: Partial<ModelCatalogVendorDto> & Pick<ModelCatalogVendorDto, 'key' | 'name'>,
): Promise<ModelCatalogVendorDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.upsertVendor(payload) as ModelCatalogVendorDto
}

export async function deleteModelCatalogVendor(key: string): Promise<void> {
  requireDesktopRuntime('model catalog').modelCatalog.deleteVendor(key)
}

export async function upsertModelCatalogVendorApiKey(
  vendorKey: string,
  payload: { apiKey: string; enabled?: boolean },
): Promise<ModelCatalogVendorApiKeyStatusDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.upsertVendorApiKey(vendorKey, payload) as ModelCatalogVendorApiKeyStatusDto
}

export async function clearModelCatalogVendorApiKey(vendorKey: string): Promise<ModelCatalogVendorApiKeyStatusDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.clearVendorApiKey(vendorKey) as ModelCatalogVendorApiKeyStatusDto
}

export async function upsertModelCatalogModel(
  payload: Partial<ModelCatalogModelDto> & Pick<ModelCatalogModelDto, 'modelKey' | 'vendorKey' | 'labelZh' | 'kind'>,
): Promise<ModelCatalogModelDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.upsertModel(payload) as ModelCatalogModelDto
}

export async function deleteModelCatalogModel(vendorKey: string, modelKey: string): Promise<void> {
  requireDesktopRuntime('model catalog').modelCatalog.deleteModel(vendorKey, modelKey)
}

export async function upsertModelCatalogMapping(
  payload: Partial<ModelCatalogMappingDto> & Pick<ModelCatalogMappingDto, 'vendorKey' | 'taskKind' | 'name'>,
): Promise<ModelCatalogMappingDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.upsertMapping(payload) as ModelCatalogMappingDto
}

export async function deleteModelCatalogMapping(id: string): Promise<void> {
  requireDesktopRuntime('model catalog').modelCatalog.deleteMapping(id)
}

export async function exportModelCatalogPackage(params?: { includeApiKeys?: boolean }): Promise<ModelCatalogImportPackageDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.exportPackage(params) as ModelCatalogImportPackageDto
}

export async function importModelCatalogPackage(payload: ModelCatalogImportPackageDto): Promise<ModelCatalogImportResultDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.importPackage(payload) as ModelCatalogImportResultDto
}

export async function fetchModelCatalogDocs(payload: { url: string }): Promise<ModelCatalogDocsFetchResultDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.fetchDocs(payload) as Promise<ModelCatalogDocsFetchResultDto>
}

export async function testModelCatalogMapping(
  id: string,
  payload: ModelCatalogMappingTestRequestDto,
): Promise<ModelCatalogMappingTestResultDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.testMapping(id, payload) as Promise<ModelCatalogMappingTestResultDto>
}
