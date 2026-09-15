import { useState } from 'react'
import JsonHighlight from './JsonHighlight'
import './FormatJsonPage.css'

type IndentStyle = 'spaces' | 'tabs'
type OutputView = 'formatted' | 'tree'

function JsonTreeNode({ name, value }: { name?: string; value: unknown }) {
  const [expanded, setExpanded] = useState(true)
  const isArray = Array.isArray(value)
  const isObject = value !== null && typeof value === 'object'

  if (!isObject) {
    return (
      <div className="fj-tree-row">
        {name !== undefined && <span className="fj-tree-key">{name}:</span>}
        <span className={`fj-tree-value fj-tree-value--${value === null ? 'null' : typeof value}`}>{JSON.stringify(value)}</span>
      </div>
    )
  }

  const entries = Object.entries(value as Record<string, unknown>)
  const label = isArray ? `Array (${entries.length})` : `Object (${entries.length})`

  return (
    <div className="fj-tree-node">
      <button className="fj-tree-toggle" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
        <svg className={`fj-tree-chevron${expanded ? ' fj-tree-chevron--expanded' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        {name !== undefined && <span className="fj-tree-key">{name}:</span>}
        <span className="fj-tree-collection">{label}</span>
      </button>
      {expanded && <div className="fj-tree-children">
        {entries.map(([childName, childValue]) => <JsonTreeNode key={childName} name={childName} value={childValue} />)}
      </div>}
    </div>
  )
}

export default function FormatJsonPage() {
  const [input, setInput] = useState('')
  const [indentStyle, setIndentStyle] = useState<IndentStyle>('spaces')
  const [indentSize, setIndentSize] = useState(2)
  const [formatted, setFormatted] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
    const [outputView, setOutputView] = useState<OutputView>('formatted')

  function formatJson(value: string) {
    setInput(value)

    if (!value.trim()) {
      setFormatted(null)
      setError(null)
      return
    }

    try {
      const indent = indentStyle === 'tabs' ? '\t'.repeat(indentSize) : indentSize
      setFormatted(JSON.stringify(JSON.parse(value), null, indent))
      setError(null)
    } catch (formatError) {
      setFormatted(null)
      setError(formatError instanceof Error ? formatError.message : 'Unable to format this JSON.')
    }
  }

  function updateIndentStyle(value: IndentStyle) {
    setIndentStyle(value)
    const indent = value === 'tabs' ? '\t'.repeat(indentSize) : indentSize
    try {
      setFormatted(input.trim() ? JSON.stringify(JSON.parse(input), null, indent) : null)
      setError(null)
    } catch (formatError) {
      setFormatted(null)
      setError(formatError instanceof Error ? formatError.message : 'Unable to format this JSON.')
    }
  }

  function updateIndentSize(value: number) {
    setIndentSize(value)
    const indent = indentStyle === 'tabs' ? '\t'.repeat(value) : value
    try {
      setFormatted(input.trim() ? JSON.stringify(JSON.parse(input), null, indent) : null)
      setError(null)
    } catch (formatError) {
      setFormatted(null)
      setError(formatError instanceof Error ? formatError.message : 'Unable to format this JSON.')
    }
  }

  async function copyFormattedJson() {
    if (!formatted) return
    await navigator.clipboard.writeText(formatted)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="fj-page">
      <header className="fj-header">
        <div>
          <h1>Format JSON</h1>
          <p>Format JSON locally with your preferred indentation.</p>
        </div>
      </header>

      <section className="fj-controls" aria-label="JSON formatting options">
        <fieldset>
          <legend>Indentation</legend>
          <label><input type="radio" name="indent-style" checked={indentStyle === 'spaces'} onChange={() => updateIndentStyle('spaces')} /> Spaces</label>
          <label><input type="radio" name="indent-style" checked={indentStyle === 'tabs'} onChange={() => updateIndentStyle('tabs')} /> Tabs</label>
        </fieldset>
        <label className="fj-size-label" htmlFor="indent-size">Characters per level
          <select id="indent-size" value={indentSize} onChange={(event) => updateIndentSize(Number(event.target.value))}>
            {[1, 2, 3, 4, 8].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button className="fj-clear" type="button" onClick={() => formatJson('')} disabled={!input}>Clear</button>
      </section>

      <div className="fj-workspace">
        <section className="fj-editor">
          <label htmlFor="json-input">Input JSON</label>
          <textarea
            id="json-input"
            className={`fj-textarea${error ? ' fj-textarea--error' : ''}`}
            value={input}
            onChange={(event) => formatJson(event.target.value)}
            placeholder='{"queue":"orders","enabled":true,"retries":3}'
            rows={18}
            spellCheck={false}
            autoComplete="off"
          />
          {error && <p className="fj-error" role="alert">{error}</p>}
        </section>
        <section className="fj-output" aria-labelledby="formatted-json">
          <div className="fj-output-header">
            <h2 id="formatted-json">Formatted JSON</h2>
              <div className="fj-output-tabs" role="tablist" aria-label="JSON output views">
                <button className={`fj-output-tab${outputView === 'formatted' ? ' fj-output-tab--active' : ''}`} type="button" role="tab" aria-selected={outputView === 'formatted'} onClick={() => setOutputView('formatted')}>Formatted</button>
                <button className={`fj-output-tab${outputView === 'tree' ? ' fj-output-tab--active' : ''}`} type="button" role="tab" aria-selected={outputView === 'tree'} onClick={() => setOutputView('tree')}>Tree</button>
              </div>
            <button className={`fj-copy${copied ? ' fj-copy--done' : ''}`} type="button" onClick={copyFormattedJson} disabled={!formatted} title={copied ? 'Copied' : 'Copy formatted JSON'} aria-label={copied ? 'Formatted JSON copied' : 'Copy formatted JSON'}>
              {copied ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              )}
            </button>
          </div>
            {formatted ? outputView === 'formatted' ? <JsonHighlight json={formatted} /> : <div className="fj-tree"><JsonTreeNode value={JSON.parse(formatted)} /></div> : <p className="fj-empty">Formatted JSON will appear here.</p>}
        </section>
      </div>
    </div>
  )
}