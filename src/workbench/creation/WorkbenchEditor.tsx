import React from 'react'
import { EditorContent, type Editor, type JSONContent } from '@tiptap/react'
import SelectionGeneratePopover from './SelectionGeneratePopover'
import { WorkbenchIconButton } from '../../design/workbenchActions'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvasV2/store/generationCanvasStore'
import { normalizeWorkbenchContentJson, type CreationDocumentTools } from '../workbenchTypes'
import { createImageNodeFromContent, createStoryboardNodeFromContent } from './creationNodeCommands'
import { useTransientScrollingClass } from './useTransientScrollingClass'
import { useNomiRichTextEditor } from '../common/useNomiRichTextEditor'
import { buildRichTextActions } from '../common/richTextActions'

const CREATION_PLACEHOLDER =
  '从这里开始写你的故事或剧本...\n\n💡 选中文字后，点右侧「生成图片」或「生成视频」，画布会自动创建对应节点。'

function WorkbenchEditorToolbar({ editor }: { editor: Editor | null }): JSX.Element {
  const actions = buildRichTextActions(editor)
  return (
    <div
      className={cn(
        'workbench-editor-toolbar',
        'h-[44px] flex items-center gap-1 px-3',
        'border-b border-workbench-border-soft bg-workbench-surface',
      )}
      aria-label="文本工具栏"
    >
      {actions.map((action) => (
        <WorkbenchIconButton
          key={action.id}
          className={cn(
            'workbench-editor-toolbar__button',
            'w-[30px] h-[30px] inline-grid place-items-center',
            'border border-transparent rounded-[7px]',
            'bg-transparent text-workbench-muted cursor-pointer',
            'hover:bg-workbench-hover',
            'focus-visible:outline-2 focus-visible:outline-workbench-focus focus-visible:outline-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-[0.38]',
          )}
          label={action.label}
          data-active={action.active ? 'true' : 'false'}
          disabled={action.disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={action.onClick}
          icon={action.icon}
        />
      ))}
      <div className="flex-1" aria-hidden="true" />
    </div>
  )
}

export default function WorkbenchEditor(): JSX.Element {
  const workbenchDocument = useWorkbenchStore((state) => state.workbenchDocument)
  const setWorkbenchDocument = useWorkbenchStore((state) => state.setWorkbenchDocument)
  const setCreationDocumentTools = useWorkbenchStore((state) => state.setCreationDocumentTools)
  const setCreationSelectionText = useWorkbenchStore((state) => state.setCreationSelectionText)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  const addGenerationNode = useGenerationCanvasStore((state) => state.addNode)
  const [selectedText, setSelectedText] = React.useState('')
  const scrollRef = useTransientScrollingClass<HTMLDivElement>('workbench-scrollbar-visible')
  const workbenchDocumentRef = React.useRef(workbenchDocument)

  React.useEffect(() => {
    workbenchDocumentRef.current = workbenchDocument
  }, [workbenchDocument])

  const editorContent = React.useMemo(
    () => normalizeWorkbenchContentJson(workbenchDocument.contentJson) as JSONContent,
    [workbenchDocument.contentJson],
  )

  const handleChange = React.useCallback(
    (contentJson: JSONContent) => {
      setWorkbenchDocument({ ...workbenchDocumentRef.current, contentJson, updatedAt: Date.now() })
    },
    [setWorkbenchDocument],
  )

  const handleSelectionChange = React.useCallback(
    (text: string) => {
      setSelectedText(text)
      setCreationSelectionText(text)
    },
    [setCreationSelectionText],
  )

  const { editor, tools } = useNomiRichTextEditor({
    content: editorContent,
    placeholder: CREATION_PLACEHOLDER,
    onChange: handleChange,
    onSelectionChange: handleSelectionChange,
  })

  // Publish creation document tools = shared rich-text tools + creation-only node creators.
  const creationDocumentToolsRef = React.useRef<CreationDocumentTools | null>(null)
  React.useEffect(() => {
    if (!editor) return
    const toolsApi: CreationDocumentTools = {
      readFullText: tools.readFullText,
      readSelectionText: tools.readSelectionText,
      insertAtCursor: tools.insertAtCursor,
      replaceSelection: tools.replaceSelection,
      appendToEnd: tools.appendToEnd,
      writeDocument: tools.appendToEnd,
      generateStoryboardNode: (content) =>
        createStoryboardNodeFromContent(content, { addGenerationNode, setWorkspaceMode }),
      generateAssetNode: (content) =>
        createImageNodeFromContent(content, { addGenerationNode, setWorkspaceMode }),
    }
    setCreationDocumentTools(toolsApi)
    creationDocumentToolsRef.current = toolsApi
    return () => {
      if (creationDocumentToolsRef.current === toolsApi) {
        setCreationDocumentTools(null)
        creationDocumentToolsRef.current = null
      }
    }
  }, [editor, tools, addGenerationNode, setCreationDocumentTools, setWorkspaceMode])

  return (
    <section
      className={cn(
        'workbench-editor',
        'relative w-full h-full min-h-0',
        'grid grid-rows-[44px_minmax(0,1fr)]',
        'border border-workbench-border rounded-workbench',
        'bg-workbench-surface-solid shadow-workbench-md',
        'overflow-hidden',
      )}
      aria-label="创作文档编辑区"
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <WorkbenchEditorToolbar editor={editor} />
      <SelectionGeneratePopover editor={editor} selectedText={selectedText} onCreated={() => setSelectedText('')} />
      <div
        ref={scrollRef}
        className={cn('workbench-editor__scroll', 'min-w-0 min-h-0 overflow-auto')}
      >
        <EditorContent editor={editor} />
      </div>
    </section>
  )
}
