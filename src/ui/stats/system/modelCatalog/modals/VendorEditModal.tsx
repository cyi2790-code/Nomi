import React from 'react'
import { Group, Stack } from '@mantine/core'
import type { ModelCatalogVendorAuthType, ModelCatalogVendorDto, ModelCatalogVendorProviderKind } from '../deps'
import { toast, upsertModelCatalogVendor } from '../deps'
import { AUTH_TYPE_OPTIONS, PROVIDER_KIND_OPTIONS } from '../modelCatalog.constants'
import { prettyJson, safeParseJson } from '../modelCatalog.utils'
import { DesignButton, DesignModal, DesignSelect, DesignSwitch, DesignTextInput, DesignTextarea } from '../../../../../design'
import { cn } from '../../../../../utils/cn'

export type VendorEditorState = { mode: 'create' } | { mode: 'edit'; vendor: ModelCatalogVendorDto }

export function VendorEditModal({
  editor,
  onClose,
  onSaved,
}: {
  editor: VendorEditorState | null
  onClose: () => void
  onSaved: () => Promise<void> | void
}): JSX.Element {
  const opened = !!editor
  const isNew = editor?.mode === 'create'
  const editingVendor = editor && editor.mode === 'edit' ? editor.vendor : null

  const [submitting, setSubmitting] = React.useState(false)
  const [vendorKey, setVendorKey] = React.useState('')
  const [vendorName, setVendorName] = React.useState('')
  const [vendorEnabled, setVendorEnabled] = React.useState(true)
  const [vendorBaseUrlHint, setVendorBaseUrlHint] = React.useState('')
  const [vendorAuthType, setVendorAuthType] = React.useState<ModelCatalogVendorAuthType>('bearer')
  const [vendorProviderKind, setVendorProviderKind] = React.useState<ModelCatalogVendorProviderKind>('openai-compatible')
  const [vendorAuthHeader, setVendorAuthHeader] = React.useState('')
  const [vendorAuthQueryParam, setVendorAuthQueryParam] = React.useState('')
  const [vendorMeta, setVendorMeta] = React.useState('')
  const [vendorAdvanced, setVendorAdvanced] = React.useState(false)

  React.useEffect(() => {
    if (!opened) return
    if (isNew) {
      setVendorKey('')
      setVendorName('')
      setVendorEnabled(true)
      setVendorBaseUrlHint('')
      setVendorAuthType('bearer')
      setVendorProviderKind('openai-compatible')
      setVendorAuthHeader('')
      setVendorAuthQueryParam('')
      setVendorMeta('')
      setVendorAdvanced(false)
      setSubmitting(false)
      return
    }

    if (editingVendor) {
      setVendorKey(editingVendor.key)
      setVendorName(editingVendor.name || '')
      setVendorEnabled(!!editingVendor.enabled)
      setVendorBaseUrlHint((editingVendor.baseUrlHint || '').trim())
      setVendorAuthType(editingVendor.authType || 'bearer')
      setVendorProviderKind(editingVendor.providerKind || 'openai-compatible')
      setVendorAuthHeader((editingVendor.authHeader || '').trim())
      setVendorAuthQueryParam((editingVendor.authQueryParam || '').trim())
      setVendorMeta(prettyJson(editingVendor.meta))
      setVendorAdvanced(false)
      setSubmitting(false)
    }
  }, [editingVendor, isNew, opened])

  const submitVendor = React.useCallback(async () => {
    const key = vendorKey.trim()
    const name = vendorName.trim()
    if (!key) {
      toast('请填写厂商 Key（如 openai/gemini/xxx）', 'error')
      return
    }
    if (!name) {
      toast('请填写厂商名称', 'error')
      return
    }

    const metaParsed = safeParseJson(vendorMeta)
    if (!metaParsed.ok) {
      toast(`meta JSON 无效：${metaParsed.error}`, 'error')
      return
    }

    if (submitting) return
    setSubmitting(true)
    try {
      await upsertModelCatalogVendor({
        key,
        name,
        enabled: vendorEnabled,
        baseUrlHint: vendorBaseUrlHint.trim() || null,
        authType: vendorAuthType,
        authHeader: vendorAuthHeader.trim() || null,
        authQueryParam: vendorAuthQueryParam.trim() || null,
        providerKind: vendorProviderKind,
        ...(typeof metaParsed.value === 'undefined' ? {} : { meta: metaParsed.value }),
      })
      toast('已保存厂商配置', 'success')
      onClose()
      await onSaved()
    } catch (err: unknown) {
      console.error('save vendor failed', err)
      toast(err instanceof Error && err.message ? err.message : '保存厂商失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [onClose, onSaved, submitting, vendorAuthHeader, vendorAuthQueryParam, vendorAuthType, vendorBaseUrlHint, vendorEnabled, vendorKey, vendorMeta, vendorName, vendorProviderKind])

  return (
    <DesignModal className={cn('stats-model-catalog-vendor-modal')} opened={opened} onClose={onClose} title={isNew ? '新增厂商' : '编辑厂商'} size="md" radius="md" centered
        lockScroll={false}>
      <Stack className={cn('stats-model-catalog-vendor-form')} gap="sm">
        <DesignTextInput label="Key（唯一）" placeholder="例如 openai / gemini / veo" value={vendorKey} onChange={(e) => setVendorKey(e.currentTarget.value)} disabled={!isNew} />
        <DesignTextInput label="名称" placeholder="显示名称" value={vendorName} onChange={(e) => setVendorName(e.currentTarget.value)} />
        <DesignSwitch checked={vendorEnabled} onChange={(e) => setVendorEnabled(e.currentTarget.checked)} label="启用" />
        <DesignSelect
          label="鉴权方式（提示用）"
          data={AUTH_TYPE_OPTIONS}
          value={vendorAuthType}
          onChange={(value) => setVendorAuthType(value === 'x-api-key' || value === 'query' || value === 'none' ? value : 'bearer')}
        />
        <DesignSelect
          label="Provider 类型（Agent 文本调用使用）"
          data={PROVIDER_KIND_OPTIONS}
          value={vendorProviderKind}
          onChange={(value) => setVendorProviderKind(value === 'anthropic' ? 'anthropic' : 'openai-compatible')}
        />
        <DesignTextInput label="BaseUrl Hint（可选）" placeholder="例如 https://api.openai.com" value={vendorBaseUrlHint} onChange={(e) => setVendorBaseUrlHint(e.currentTarget.value)} />
        <DesignSwitch checked={vendorAdvanced} onChange={(e) => setVendorAdvanced(e.currentTarget.checked)} label="显示高级设置" />
        {vendorAdvanced ? (
          <Stack className={cn('stats-model-catalog-vendor-form-advanced')} gap="sm">
            <Group className={cn('stats-model-catalog-vendor-form-auth-extra flex-wrap items-end gap-3')} gap="sm" wrap="wrap" align="flex-end">
              <DesignTextInput label="Auth Header（可选）" placeholder="例如 X-API-Key" value={vendorAuthHeader} onChange={(e) => setVendorAuthHeader(e.currentTarget.value)} w={220} />
              <DesignTextInput label="Auth Query Param（可选）" placeholder="例如 api_key" value={vendorAuthQueryParam} onChange={(e) => setVendorAuthQueryParam(e.currentTarget.value)} w={220} />
            </Group>
            <DesignTextarea label="meta（JSON，可选）" value={vendorMeta} onChange={(e) => setVendorMeta(e.currentTarget.value)} minRows={4} autosize />
          </Stack>
        ) : null}
        <Group className={cn('stats-model-catalog-vendor-form-actions justify-end gap-2')} justify="flex-end" gap={8}>
          <DesignButton variant="subtle" onClick={onClose}>取消</DesignButton>
          <DesignButton onClick={() => void submitVendor()} loading={submitting}>
            保存
          </DesignButton>
        </Group>
      </Stack>
    </DesignModal>
  )
}
