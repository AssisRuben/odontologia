import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Texto de um capítulo do manual, com as cores do app.
const componentes: Components = {
  h2: ({ children }) => <h3 className="font-display text-lg font-semibold text-tinta mt-8 mb-3 break-after-avoid">{children}</h3>,
  h3: ({ children }) => <h4 className="text-base font-semibold text-tinta mt-6 mb-2 break-after-avoid">{children}</h4>,
  p: ({ children }) => <p className="text-[15px] leading-relaxed text-tinta-2 my-3">{children}</p>,
  ol: ({ children }) => <ol className="list-decimal pl-6 my-3 space-y-1.5 text-[15px] text-tinta-2 marker:text-petroleo marker:font-semibold">{children}</ol>,
  ul: ({ children }) => <ul className="list-disc pl-6 my-3 space-y-1.5 text-[15px] text-tinta-2 marker:text-tinta-4">{children}</ul>,
  li: ({ children }) => <li className="leading-relaxed pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-tinta">{children}</strong>,
  code: ({ children }) => <code className="px-1.5 py-0.5 rounded bg-porcelana text-[13px] text-tinta">{children}</code>,
  a: ({ href, children }) => {
    const externo = !!href && /^https?:/.test(href)
    return (
      <a href={href} className="text-petroleo font-medium underline underline-offset-2 decoration-petroleo-200 hover:decoration-petroleo"
        {...(externo ? { target: '_blank', rel: 'noreferrer' } : {})}>
        {children}
      </a>
    )
  },
  img: ({ src, alt }) => (
    <figure className="my-5 break-inside-avoid">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} loading="lazy"
        className="w-full max-w-3xl rounded-lg border border-linha shadow-sm bg-white" />
      {alt && <figcaption className="mt-2 text-xs text-tinta-3">{alt}</figcaption>}
    </figure>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="text-left font-semibold text-tinta bg-porcelana-2 border border-linha px-3 py-2">{children}</th>,
  td: ({ children }) => <td className="text-tinta-2 border border-linha px-3 py-2 align-top">{children}</td>,
}

export function ConteudoMarkdown({ texto }: { texto: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={componentes}>{texto}</Markdown>
}
