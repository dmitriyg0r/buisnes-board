import { useEffect, useMemo, useState } from 'react';
import { htmlPreviewDocument } from './html';

export function HtmlPreview({ html, title }: { html: string; title: string }) {
  const [rendered, setRendered] = useState(html);
  useEffect(() => {
    const timer = setTimeout(() => setRendered(html), 300);
    return () => clearTimeout(timer);
  }, [html]);
  const source = useMemo(() => htmlPreviewDocument(rendered), [rendered]);
  return <iframe className="html-preview" data-nodrag title={`HTML: ${title}`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={source} />;
}
