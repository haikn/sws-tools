import './JsonHighlight.css'

function tokenize(json: string): string {
  // HTML-escape first so injected spans are safe
  const safe = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return safe.replace(
    /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (token) => {
      if (token.startsWith('"')) {
        // key if ends with optional whitespace + colon
        const isKey = /"\s*:$/.test(token)
        return `<span class="${isKey ? 'jh-key' : 'jh-str'}">${token}</span>`
      }
      if (token === 'true' || token === 'false') return `<span class="jh-bool">${token}</span>`
      if (token === 'null') return `<span class="jh-null">${token}</span>`
      return `<span class="jh-num">${token}</span>`
    }
  )
}

interface Props {
  json: string
  className?: string
}

export default function JsonHighlight({ json, className }: Props) {
  return (
    <pre
      className={`jh-pre${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: tokenize(json) }}
    />
  )
}
