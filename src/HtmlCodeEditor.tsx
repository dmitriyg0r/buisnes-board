import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const colors = HighlightStyle.define([
  { tag: tags.tagName, color: '#1d4ed8' },
  { tag: tags.attributeName, color: '#8b3fb0' },
  { tag: [tags.string, tags.attributeValue], color: '#167347' },
  { tag: [tags.keyword, tags.modifier], color: '#9333a5' },
  { tag: [tags.number, tags.bool, tags.null], color: '#b45309' },
  { tag: [tags.propertyName, tags.variableName], color: '#334e80' },
  { tag: [tags.className, tags.typeName], color: '#a35412' },
  { tag: tags.unit, color: '#b45309' },
  { tag: [tags.angleBracket, tags.punctuation, tags.operator], color: '#667085' },
  { tag: tags.comment, color: '#84909f', fontStyle: 'italic' },
  { tag: tags.invalid, color: '#b42318' },
]);

/** Редактор сохраняет курсор и историю при рендерах React; HTML включает вложенные CSS и JavaScript. */
export function HtmlCodeEditor({ value, onChange, onFocus }: { value: string; onChange: (value: string) => void; onFocus: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initial = useRef(value);
  const callbacks = useRef({ onChange, onFocus });
  callbacks.current = { onChange, onFocus };
  const applyingExternal = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          html(), syntaxHighlighting(colors), lineNumbers(), drawSelection(),
          history(), bracketMatching(), indentOnInput(), indentUnit.of('  '),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'HTML-код', 'aria-multiline': 'true', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
          EditorView.domEventHandlers({ focus: () => { callbacks.current.onFocus(); } }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingExternal.current) callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    editor.focus();
    return () => { view.current = null; editor.destroy(); };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    applyingExternal.current = true;
    try { editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } }); }
    finally { applyingExternal.current = false; }
  }, [value]);

  return <div ref={host} className="html-code" />;
}
