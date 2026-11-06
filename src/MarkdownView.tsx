import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Безопасный показ Markdown: сырой HTML внутри текста не выполняется и не показывается, ссылки открываются
 * в новой вкладке без доступа к странице.
 */
export function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer nofollow" />,
          img: ({ alt }) => <span className="md-img">[изображение{alt ? `: ${alt}` : ''}]</span>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownView;
