import { useEffect, useState } from 'react'
import type { AttributeValue } from '@aws-sdk/client-dynamodb'
import {
  deleteItem,
  describeTable,
  extractItemKey,
  listTables,
  putItem,
  scanTable,
  truncateTable,
  toAttributeJson,
  toDocumentJson,
  type DynamoItem,
  type DynamoTableInfo,
} from './dynamodb'
import { getSettings } from './store'
import JsonHighlight from './JsonHighlight'
import './DynamoPage.css'

type JsonMode = 'document' | 'attribute'
type EditorState = { kind: 'add' | 'edit'; item?: DynamoItem }

interface Props {
  settingsVersion: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatAttribute(value: AttributeValue | undefined): string {
  if (!value) return '—'
  try { return JSON.stringify(toDocumentJson({ value }).value) }
  catch { return JSON.stringify(value) }
}

function itemText(item: DynamoItem, mode: JsonMode): string {
  const value = mode === 'document' ? toDocumentJson(item) : item
  return JSON.stringify(value, null, 2)
}

function RecordEditor({ table, state, onClose, onSaved }: {
  table: DynamoTableInfo
  state: EditorState
  onClose: () => void
  onSaved: () => void
}) {
  const [mode, setMode] = useState<JsonMode>('document')
  const [text, setText] = useState(() => state.item ? itemText(state.item, 'document') : '{}')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const keyNames = [table.partitionKey, ...(table.sortKey ? [table.sortKey] : [])]

  function switchMode(nextMode: JsonMode) {
    if (nextMode === mode) return
    try {
      const parsed = JSON.parse(text)
      const item = mode === 'document' ? toAttributeJson(parsed) : parsed as DynamoItem
      setText(itemText(item, nextMode))
      setMode(nextMode)
      setError(null)
    } catch (conversionError) {
      setError(errorMessage(conversionError))
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const parsed = JSON.parse(text)
      const item = mode === 'document' ? toAttributeJson(parsed) : parsed as DynamoItem
      const nextKey = extractItemKey(item, keyNames)
      if (state.kind === 'edit' && state.item) {
        const originalKey = extractItemKey(state.item, keyNames)
        if (JSON.stringify(nextKey) !== JSON.stringify(originalKey)) {
          throw new Error('Partition and sort key values cannot be changed while editing.')
        }
      }
      await putItem(table.name, item)
      onSaved()
    } catch (saveError) {
      setError(errorMessage(saveError))
      setSaving(false)
    }
  }

  return (
    <div className="dy-overlay" onClick={onClose}>
      <div className="dy-editor" onClick={(event) => event.stopPropagation()}>
        <header className="dy-dialog-header">
          <div><h2>{state.kind === 'add' ? 'Add record' : 'Edit record'}</h2><p>{table.name}</p></div>
          <button className="dy-icon-btn" onClick={onClose} aria-label="Close" title="Close">×</button>
        </header>
        <div className="dy-editor-tabs" role="tablist" aria-label="Record JSON format">
          <button className={mode === 'document' ? 'active' : ''} onClick={() => switchMode('document')} role="tab" aria-selected={mode === 'document'}>Normal JSON</button>
          <button className={mode === 'attribute' ? 'active' : ''} onClick={() => switchMode('attribute')} role="tab" aria-selected={mode === 'attribute'}>AttributeValue JSON</button>
        </div>
        <div className="dy-editor-body">
          <textarea value={text} onChange={(event) => { setText(event.target.value); setError(null) }} rows={20} spellCheck={false} autoFocus />
          {mode === 'document' && <p className="dy-editor-hint">DynamoDB sets use <code>{'{ "$set": [...] }'}</code> or <code>{'{ "$numberSet": [...] }'}</code>.</p>}
          {state.kind === 'edit' && <p className="dy-editor-hint">Saving replaces the complete record. Key values cannot be changed.</p>}
          {error && <div className="dy-error" role="alert">{error}</div>}
        </div>
        <footer className="dy-dialog-footer">
          <button className="dy-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="dy-btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save record'}</button>
        </footer>
      </div>
    </div>
  )
}

export default function DynamoPage({ settingsVersion }: Props) {
  const [tables, setTables] = useState<string[]>([])
  const [tableName, setTableName] = useState('')
  const [table, setTable] = useState<DynamoTableInfo | null>(null)
  const [items, setItems] = useState<DynamoItem[]>([])
  const [lastKey, setLastKey] = useState<DynamoItem | undefined>()
  const [pageStarts, setPageStarts] = useState<Array<DynamoItem | undefined>>([undefined])
  const [pageIndex, setPageIndex] = useState(0)
  const [selected, setSelected] = useState<DynamoItem | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deleting, setDeleting] = useState<DynamoItem | null>(null)
  const [truncating, setTruncating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadTables() {
    setLoading(true)
    setError(null)
    try {
      const names = await listTables()
      setTables(names)
      if (tableName && !names.includes(tableName)) selectTable('')
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  async function loadPage(name: string, startKey?: DynamoItem) {
    setLoading(true)
    setError(null)
    try {
      const page = await scanTable(name, startKey)
      setItems(page.items)
      setLastKey(page.lastEvaluatedKey)
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  async function selectTable(name: string) {
    setTableName(name)
    setTable(null)
    setItems([])
    setSelected(null)
    setPageStarts([undefined])
    setPageIndex(0)
    setLastKey(undefined)
    if (!name) return
    setLoading(true)
    setError(null)
    try {
      const info = await describeTable(name)
      setTable(info)
      await loadPage(name)
    } catch (loadError) {
      setError(errorMessage(loadError))
      setLoading(false)
    }
  }

  async function refreshCurrent() {
    if (!tableName) return loadTables()
    setPageStarts([undefined])
    setPageIndex(0)
    setSelected(null)
    await loadPage(tableName)
  }

  function nextPage() {
    if (!lastKey) return
    const nextIndex = pageIndex + 1
    setPageStarts((current) => [...current.slice(0, nextIndex), lastKey])
    setPageIndex(nextIndex)
    void loadPage(tableName, lastKey)
  }

  function previousPage() {
    if (pageIndex === 0) return
    const previousIndex = pageIndex - 1
    setPageIndex(previousIndex)
    void loadPage(tableName, pageStarts[previousIndex])
  }

  async function confirmDelete() {
    if (!deleting || !table) return
    setLoading(true)
    setError(null)
    try {
      await deleteItem(table.name, extractItemKey(deleting, [table.partitionKey, ...(table.sortKey ? [table.sortKey] : [])]))
      setDeleting(null)
      setSelected(null)
      await refreshCurrent()
    } catch (deleteError) {
      setError(errorMessage(deleteError))
      setLoading(false)
    }
  }

  async function quickDelete(item: DynamoItem) {
    if (!table || !getSettings().dynamoQuickDelete) return
    setLoading(true)
    setError(null)
    try {
      await deleteItem(table.name, extractItemKey(item, keyNames))
      if (selected === item) setSelected(null)
      await refreshCurrent()
    } catch (deleteError) {
      setError(errorMessage(deleteError))
      setLoading(false)
    }
  }

  async function confirmTruncate() {
    if (!table) return
    setLoading(true)
    setError(null)
    try {
      await truncateTable(table.name, keyNames)
      setTruncating(false)
      setSelected(null)
      await refreshCurrent()
    } catch (truncateError) {
      setError(errorMessage(truncateError))
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    listTables().then((names) => {
      if (!active) return
      setTables(names)
      setTable(null)
      setItems([])
      setSelected(null)
      setError(null)
      const savedTable = getSettings().dynamoDefaultTable
      const nextTable = savedTable && names.includes(savedTable) ? savedTable : names[0] ?? ''
      if (nextTable) {
        void selectTable(nextTable)
      } else {
        setTableName('')
        setLoading(false)
      }
    }).catch((loadError) => {
      if (!active) return
      setError(errorMessage(loadError))
      setLoading(false)
    })
    return () => { active = false }
  // selectTable is intentionally omitted: this effect is a settings-version load boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsVersion])

  useEffect(() => {
    const seconds = getSettings().dynamoRefreshSeconds
    if (!tableName || seconds <= 0) return
    const timer = window.setInterval(() => { void refreshCurrent() }, seconds * 1000)
    return () => window.clearInterval(timer)
  }, [tableName, settingsVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const keyNames = table ? [table.partitionKey, ...(table.sortKey ? [table.sortKey] : [])] : []

  return (
    <div className="dy-page">
      {editor && table && <RecordEditor table={table} state={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void refreshCurrent() }} />}
      {deleting && table && <div className="dy-overlay" onClick={() => setDeleting(null)}>
        <div className="dy-confirm" onClick={(event) => event.stopPropagation()}>
          <h2>Delete record?</h2>
          <p>This permanently deletes the record identified by:</p>
          <JsonHighlight json={JSON.stringify(toDocumentJson(extractItemKey(deleting, keyNames)), null, 2)} />
          <div className="dy-dialog-footer"><button className="dy-btn-secondary" onClick={() => setDeleting(null)}>Cancel</button><button className="dy-btn-danger" onClick={confirmDelete}>Delete</button></div>
        </div>
      </div>}

      <header className="dy-page-header">
        <div><h1>DynamoDB</h1><p>Browse and manage LocalStack table records.</p></div>
        <div className="dy-header-actions">
          <select value={tableName} onChange={(event) => void selectTable(event.target.value)} aria-label="DynamoDB table">
            <option value="">Select table…</option>
            {tables.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button className="dy-icon-btn" onClick={() => void refreshCurrent()} disabled={loading} aria-label="Refresh" title="Refresh">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
          <button className="dy-btn-danger-outline" onClick={() => setTruncating(true)} disabled={!table || loading}>Truncate table</button>
          <button className="dy-btn-primary" onClick={() => setEditor({ kind: 'add' })} disabled={!table}>Add record</button>
        </div>
      </header>

      {error && <div className="dy-error" role="alert">{error}</div>}

      {truncating && table && <div className="dy-overlay" onClick={() => setTruncating(false)}>
        <div className="dy-confirm" onClick={(event) => event.stopPropagation()}>
          <h2>Truncate table?</h2>
          <p>This permanently deletes every record from <strong>{table.name}</strong>. This action cannot be undone.</p>
          <div className="dy-dialog-footer"><button className="dy-btn-secondary" onClick={() => setTruncating(false)}>Cancel</button><button className="dy-btn-danger" onClick={() => void confirmTruncate()} disabled={loading}>Truncate table</button></div>
        </div>
      </div>}

      {!tableName ? <div className="dy-empty">{loading ? 'Loading tables…' : tables.length ? 'Select a table to view its records.' : 'No DynamoDB tables found.'}</div> : table && <>
        <div className="dy-meta">
          <span><strong>Partition key</strong><code>{table.partitionKey}</code></span>
          {table.sortKey && <span><strong>Sort key</strong><code>{table.sortKey}</code></span>}
          <span><strong>Reported items</strong>{table.itemCount}</span>
        </div>

        <div className="dy-content">
          <section className="dy-list">
            <div className={`dy-list-head${table.sortKey ? ' dy-grid--two-keys' : ''}`}>
              {keyNames.map((name) => <span key={name}>{name}</span>)}
              <span>Attributes</span>
            </div>
            {loading && items.length === 0 ? <div className="dy-empty">Loading records…</div> : items.length === 0 ? <div className="dy-empty">This scan page contains no records.</div> : items.map((item, index) => {
              const document = toDocumentJson(item)
              const summary = Object.fromEntries(Object.entries(document).filter(([name]) => !keyNames.includes(name)))
              return <button className={`dy-row${table.sortKey ? ' dy-grid--two-keys' : ''}${selected === item ? ' active' : ''}`} key={`${JSON.stringify(extractItemKey(item, keyNames))}-${index}`} onClick={() => setSelected(item)} onContextMenu={(event) => { if (getSettings().dynamoQuickDelete) { event.preventDefault(); void quickDelete(item) } }}>
                {keyNames.map((name) => <code key={name}>{formatAttribute(item[name])}</code>)}
                <code className="dy-summary">{JSON.stringify(summary)}</code>
              </button>
            })}
            <footer className="dy-pagination">
              <button onClick={previousPage} disabled={pageIndex === 0 || loading}>Previous</button>
              <span>Page {pageIndex + 1}</span>
              <button onClick={nextPage} disabled={!lastKey || loading}>Next</button>
            </footer>
            {selected && <div className="dy-record-detail">
              <div className="dy-detail-header"><h2>Record detail</h2><div><button className="dy-btn-secondary" onClick={() => setEditor({ kind: 'edit', item: selected })}>Edit</button><button className="dy-btn-danger-outline" onClick={() => setDeleting(selected)}>Delete</button></div></div>
              <JsonHighlight json={JSON.stringify(toDocumentJson(selected), null, 2)} />
            </div>}
          </section>
        </div>
      </>}
    </div>
  )
}