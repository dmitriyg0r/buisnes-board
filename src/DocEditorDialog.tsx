import { useRef, useState } from 'react';
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type MDXEditorMethods,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { Icon } from './Icon';
import { ru } from './mdxRu';

interface Props {
  title: string;
  markdown: string;
  onSave: (title: string, markdown: string) => void;
  onClose: () => void;
}

/** Блок кода редактируется обычным текстовым полем: без подсветки, зато без тяжёлых зависимостей. */
function PlainCode({ code }: { code: string; language: string; meta: string }) {
  const { setCode } = useCodeBlockEditorContext();
  return (
    <textarea
      className="md-code-input"
      value={code}
      rows={Math.max(3, code.split('\n').length)}
      spellCheck={false}
      aria-label="Код"
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => setCode(e.target.value)}
    />
  );
}

const codeBlocks: CodeBlockEditorDescriptor[] = [{ priority: -10, match: () => true, Editor: PlainCode }];

/**
 * Полноэкранный редактор документа в одном окне, как в Obsidian: пишете обычный текст, а разметка применяется
 * сразу. «# » делает заголовок, «**» — жирный, «- » — список. Исходный Markdown доступен переключателем.
 */
export default function DocEditorDialog({ title, markdown, onSave, onClose }: Props) {
  const editor = useRef<MDXEditorMethods>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(title);
  const [text, setText] = useState(markdown);
  // редактор приводит текст к своему виду при открытии; это не правка, поэтому сравниваем с таким видом
  const [baseline, setBaseline] = useState(markdown);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== title || text !== baseline;

  const save = () => onSave(name.trim() || 'Документ', text);

  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.trim() || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError('Файл слишком большой: до 2 МБ.');
      return;
    }
    setError(null);
    const content = await file.text();
    editor.current?.setMarkdown(content);
    setText(content);
  };

  const close = () => {
    if (dirty && !confirmClose) setConfirmClose(true);
    else onClose();
  };

  return (
    <div
      className="doc-editor"
      role="dialog"
      aria-modal="true"
      aria-label="Редактор документа"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
          e.preventDefault();
          save();
        }
      }}
    >
      <header className="bpmn-head">
        <span className="dlg-icon"><Icon name="file" size={18} /></span>
        <input className="bpmn-title" value={name} aria-label="Название документа" onChange={(e) => setName(e.target.value)} />
        <div className="grow" />
        {error && <span className="bpmn-error" role="alert">{error}</span>}
        <input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>Импорт .md</button>
        <button type="button" className="btn" onClick={exportFile}>Экспорт .md</button>
        {confirmClose ? (
          <>
            <span className="bpmn-warn">Есть несохранённые изменения</span>
            <button type="button" className="btn btn-danger" onClick={onClose}>Закрыть без сохранения</button>
            <button type="button" className="btn" onClick={() => setConfirmClose(false)}>Продолжить правку</button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={close}>Закрыть</button>
            <button type="button" className="btn btn-dark" disabled={!dirty} onClick={save}>Сохранить</button>
          </>
        )}
      </header>

      <MDXEditor
        ref={editor}
        className="mdx-root"
        contentEditableClassName="md md-live"
        markdown={markdown}
        translation={ru}
        placeholder="Начните писать. «# » в начале строки делает заголовок, «- » список, «**текст**» жирный."
        onChange={(md, initial) => {
          setText(md);
          if (initial) setBaseline(md);
        }}
        onError={() => setError('В тексте есть разметка, которую редактор не понимает. Откройте «Исходный текст» и поправьте её.')}
        plugins={[
          headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4] }),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          tablePlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: '', codeBlockEditorDescriptors: codeBlocks }),
          markdownShortcutPlugin(),
          diffSourcePlugin({ viewMode: 'rich-text' }),
          toolbarPlugin({
            toolbarContents: () => (
              <DiffSourceToggleWrapper>
                <UndoRedo />
                <Separator />
                <BlockTypeSelect />
                <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
                <CodeToggle />
                <Separator />
                <ListsToggle options={['bullet', 'number']} />
                <Separator />
                <CreateLink />
                <InsertTable />
                <InsertThematicBreak />
              </DiffSourceToggleWrapper>
            ),
          }),
        ]}
      />
    </div>
  );
}
