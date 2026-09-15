import { useEffect, useState } from 'react'
import { getSavedQueries, getSettings, saveSavedQueries, saveSettings, type SavedQuery } from './store'
import JsonHighlight from './JsonHighlight'
import { isExtensionWebview, requestBackend } from './platformApi'
import './PostgresPage.css'

type ViewTab = 'description' | 'data'
type EditorMode = 'add' | 'edit'

interface TableSummary { schema: string; name: string; count: number }
interface ColumnInfo { column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null; is_primary: boolean }
interface TableDetails { columns: ColumnInfo[]; count: number; primaryKeys: string[]; rowIdentity: string[]; indexes?: Array<{ name: string; definition: string }>; triggers?: Array<{ name: string; event: string; definition: string }> }
interface TableRows { rows: Array<Record<string, unknown>>; hasNext: boolean }
interface QueryResult { columns: string[]; rows: Array<Record<string, unknown>>; rowCount: number; command: string }
interface DatabaseObjects { views: Array<{ schema: string; name: string; definition: string }>; routines: Array<{ schema: string; name: string; type: string; definition: string | null }> }

async function postgres<T>(body: Record<string, unknown>): Promise<T> {
  return requestBackend<T>('/_postgres', body)
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function rowKey(row: Record<string, unknown>, keys: string[]): string {
  return JSON.stringify(keys.map((key) => row[key]))
}

function visibleRow(row: Record<string, unknown>): Record<string, unknown> {
  const values = { ...row }
  delete values.__sws_ctid
  return values
}

function displayTable(table: TableSummary): string {
  return table.schema === 'public' ? table.name : `${table.schema}.${table.name}`
}

function PostgresRowDetail({ table, details, row, onSaved }: { table: TableSummary; details: TableDetails; row: Record<string, unknown>; onSaved: (updated: Record<string, unknown>) => Promise<void> | void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const identity = details.rowIdentity
  const values = visibleRow(row)

  function beginEdit(name: string, value: unknown) {
    if (details.primaryKeys.includes(name)) return
    setEditing(name)
    setDraft(value === null ? 'null' : typeof value === 'string' ? value : JSON.stringify(value))
  }

  async function saveField(name: string) {
    if (editing !== name || saving) return
    setSaving(true)
    setError(null)
    try {
      let value: unknown = draft
      try { value = JSON.parse(draft) } catch { /* plain text value */ }
      const record = { ...values, [name]: value }
      await postgres({ action: 'update', schema: table.schema, table: table.name, record, keys: Object.fromEntries(identity.map((key) => [key, row[key]])) })
      await onSaved({ ...row, [name]: value })
      setEditing(null)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  return <div className="pg-inline-fields">
    {Object.entries(values).map(([name, value]) => <div className="pg-inline-field" key={name}>
      <code className="pg-inline-field-name">{name}</code>
      {editing === name ? <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void saveField(name)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setEditing(null) }} /> : <span className={`pg-inline-field-value${details.primaryKeys.includes(name) ? ' pg-inline-field-value--key' : ''}`} onDoubleClick={() => beginEdit(name, value)} title={details.primaryKeys.includes(name) ? 'Primary key' : 'Double-click to edit'}>{displayValue(value)}</span>}
    </div>)}
    {error && <div className="pg-inline-error" role="alert">{error}</div>}
  </div>
}

function RecordEditor({ table, details, mode, initial, onClose, onSaved }: { table: TableSummary; details: TableDetails; mode: EditorMode; initial?: Record<string, unknown>; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(JSON.stringify(initial ? visibleRow(initial) : {}, null, 2))
  const [record, setRecord] = useState<Record<string, unknown>>(() => initial ? visibleRow(initial) : Object.fromEntries(details.columns.map((column) => [column.column_name, null])))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const nextRecord = mode === 'add' ? record : JSON.parse(text) as Record<string, unknown>
      if (!nextRecord || Array.isArray(nextRecord) || typeof nextRecord !== 'object') throw new Error('Record must be a JSON object.')
      const identity = details.rowIdentity
      const keys = Object.fromEntries(identity.map((key) => [key, mode === 'edit' && key === '__sws_ctid' ? initial?.[key] : nextRecord[key]]))
      if (mode === 'edit' && identity.some((key) => keys[key] === undefined)) throw new Error('The row identity is missing.')
      await postgres({ action: mode === 'add' ? 'insert' : 'update', schema: table.schema, table: table.name, record: nextRecord, keys })
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      setSaving(false)
    }
  }

  return <div className="pg-overlay" onClick={onClose}>
    <div className="pg-dialog" onClick={(event) => event.stopPropagation()}>
      <header className="pg-dialog-header"><div><h2>{mode === 'add' ? 'Add row' : 'Edit row'}</h2><p>{displayTable(table)}</p></div><button className="pg-close" onClick={onClose} aria-label="Close">×</button></header>
      <div className="pg-dialog-body">
        {mode === 'add' ? <div className="pg-add-fields">
          {details.columns.map((column) => {
            const value = record[column.column_name]
            const numeric = /int|numeric|decimal|real|double|money/i.test(column.data_type)
            const boolean = column.data_type === 'boolean'
            return <div className="pg-add-field" key={column.column_name}>
              <label htmlFor={`pg-add-${column.column_name}`}>{column.column_name}{column.is_nullable === 'NO' ? ' *' : ''}</label>
              {boolean ? <select id={`pg-add-${column.column_name}`} value={value === null ? '' : String(value)} onChange={(event) => setRecord((current) => ({ ...current, [column.column_name]: event.target.value === '' ? null : event.target.value === 'true' }))}><option value="">NULL</option><option value="true">true</option><option value="false">false</option></select> : <input id={`pg-add-${column.column_name}`} type={numeric ? 'number' : 'text'} value={value === null || value === undefined ? '' : String(value)} placeholder={column.data_type} onChange={(event) => setRecord((current) => ({ ...current, [column.column_name]: event.target.value === '' ? null : numeric ? Number(event.target.value) : event.target.value }))} />}
            </div>
          })}
        </div> : <textarea value={text} onChange={(event) => { setText(event.target.value); setError(null) }} rows={18} spellCheck={false} autoFocus />}
        {mode === 'edit' && <p className="pg-hint">Primary key values cannot be changed.</p>}
        {error && <div className="pg-error">{error}</div>}
      </div>
      <footer className="pg-dialog-footer"><button className="pg-secondary" onClick={onClose}>Cancel</button><button className="pg-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save row'}</button></footer>
    </div>
  </div>
}

export default function PostgresPage() {
  const [tables, setTables] = useState<TableSummary[]>([])
  const [databases, setDatabases] = useState<string[]>([])
  const [database, setDatabase] = useState(getSettings().postgresDatabase)
  const [objects, setObjects] = useState<DatabaseObjects>({ views: [], routines: [] })
  const [selectedTable, setSelectedTable] = useState<TableSummary | null>(null)
  const [details, setDetails] = useState<TableDetails | null>(null)
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null)
  const [page, setPage] = useState(0)
  const [hasNext, setHasNext] = useState(false)
  const [tab, setTab] = useState<ViewTab>('data')
  const [editor, setEditor] = useState<EditorMode | null>(null)
  const [deleting, setDeleting] = useState<Record<string, unknown> | null>(null)
  const [truncating, setTruncating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queryOpen, setQueryOpen] = useState(false)
  const [queryText, setQueryText] = useState('')
  const [queryName, setQueryName] = useState('')
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(getSavedQueries)
  const [queryConfirm, setQueryConfirm] = useState(false)
  const [queryRunning, setQueryRunning] = useState(false)

  function isDestructiveQuery(sql: string): boolean {
    return /^(UPDATE|DELETE|INSERT|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/i.test(sql.trim())
  }

  async function runQuery() {
    const sql = queryText.trim()
    if (!sql) return
    if (isDestructiveQuery(sql) && !queryConfirm) { setQueryConfirm(true); return }
    setQueryRunning(true)
    setQueryConfirm(false)
    setError(null)
    try {
      setQueryResult(await postgres<QueryResult>({ action: 'executeQuery', sql }))
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : String(queryError))
    } finally { setQueryRunning(false) }
  }

  function saveQuery() {
    const sql = queryText.trim()
    const name = queryName.trim() || `Query ${savedQueries.length + 1}`
    if (!sql) return
    const next = [{ id: crypto.randomUUID(), name, sql, updatedAt: new Date().toISOString() }, ...savedQueries]
    setSavedQueries(next)
    saveSavedQueries(next)
    setQueryName('')
  }

  async function loadTables() {
    try {
      const databaseResult = await postgres<{ databases: string[] }>({ action: 'databases' })
      setDatabases(databaseResult.databases.includes(database) ? databaseResult.databases : [database, ...databaseResult.databases])
      const result = await postgres<{ tables: TableSummary[] }>({ action: 'tables' })
      setTables(result.tables)
      setObjects(await postgres<DatabaseObjects>({ action: 'objects' }))
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : String(loadError)) }
  }

  async function changeDatabase(nextDatabase: string) {
    if (!nextDatabase || nextDatabase === database) return
    setDatabase(nextDatabase)
    setSelectedTable(null)
    setSelectedRow(null)
    setDetails(null)
    setRows([])
    setPage(0)
    const settings = getSettings()
    if (isExtensionWebview()) {
      await requestBackend('/_extension_settings', { action: 'setPostgresDatabase', database: nextDatabase })
    } else {
      saveSettings({ ...settings, postgresDatabase: nextDatabase })
    }
    try {
      await loadTables()
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : String(changeError))
    }
  }

  async function selectTable(table: TableSummary) {
    setSelectedTable(table)
    setSelectedRow(null)
    setDetails(null)
    setRows([])
    setPage(0)
    if (!table) return
    setLoading(true)
    setError(null)
    try {
      const info = await postgres<TableDetails>({ action: 'describe', schema: table.schema, table: table.name })
      setDetails(info)
      await loadRows(table, 0, info)
      setTab('data')
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : String(loadError)) } finally { setLoading(false) }
  }

  async function loadRows(table = selectedTable, pageNumber = page, info = details) {
    if (!table) return
    const metadata = info ?? await postgres<TableDetails>({ action: 'describe', schema: table.schema, table: table.name })
    const result = await postgres<TableRows>({ action: 'rows', schema: table.schema, table: table.name, offset: pageNumber * 10, limit: 10, orderBy: metadata.primaryKeys })
    setRows(result.rows)
    setHasNext(result.hasNext)
    setPage(pageNumber)
  }

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      await loadTables()
      if (selectedTable) {
        const info = await postgres<TableDetails>({ action: 'describe', schema: selectedTable.schema, table: selectedTable.name })
        setDetails(info)
        await loadRows(selectedTable, 0, info)
        setPage(0)
      }
    } catch (refreshError) { setError(refreshError instanceof Error ? refreshError.message : String(refreshError)) } finally { setLoading(false) }
  }

  async function deleteRow(row: Record<string, unknown>, confirm: boolean) {
    if (!selectedTable || !details || !details.rowIdentity.length) return
    if (confirm) { setDeleting(row); return }
    setLoading(true)
    try {
      await postgres({ action: 'delete', schema: selectedTable.schema, table: selectedTable.name, keys: Object.fromEntries(details.rowIdentity.map((key) => [key, row[key]])) })
      setSelectedRow(null)
      await refresh()
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : String(deleteError)); setLoading(false) }
  }

  async function truncate() {
    if (!selectedTable) return
    setLoading(true)
    try { await postgres({ action: 'truncate', schema: selectedTable.schema, table: selectedTable.name }); setTruncating(false); setSelectedRow(null); await refresh() }
    catch (truncateError) { setError(truncateError instanceof Error ? truncateError.message : String(truncateError)); setLoading(false) }
  }

  useEffect(() => {
    void Promise.resolve().then(() => loadTables())
  // The loader is intentionally run once when the PostgreSQL view mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const seconds = getSettings().postgresRefreshSeconds
    if (!selectedTable || seconds <= 0) return
    const timer = window.setInterval(() => { void refresh() }, seconds * 1000)
    return () => window.clearInterval(timer)
  }, [selectedTable]) // eslint-disable-line react-hooks/exhaustive-deps

  const quickDelete = getSettings().postgresQuickDelete
  const primaryKeys = details?.primaryKeys ?? []
  const rowIdentity = details?.rowIdentity ?? []

  return <div className="pg-page">
    {queryOpen && <div className="pg-overlay" onClick={() => setQueryOpen(false)}><div className="pg-query-dialog" onClick={(event) => event.stopPropagation()}>
      <header className="pg-dialog-header"><div><h2>Run a query</h2><p>{selectedTable ? displayTable(selectedTable) : 'PostgreSQL database'}</p></div><button className="pg-close" onClick={() => setQueryOpen(false)} aria-label="Close">×</button></header>
      <div className="pg-query-body">
        <div className="pg-query-toolbar"><input value={queryName} onChange={(event) => setQueryName(event.target.value)} placeholder="Saved query name" /><button className="pg-secondary" onClick={saveQuery} disabled={!queryText.trim()}>Save query</button></div>
        {savedQueries.length > 0 && <select className="pg-saved-query" value="" onChange={(event) => { const query = savedQueries.find((item) => item.id === event.target.value); if (query) { setQueryName(query.name); setQueryText(query.sql) } }}><option value="">Load saved query…</option>{savedQueries.map((query) => <option key={query.id} value={query.id}>{query.name}</option>)}</select>}
        <textarea value={queryText} onChange={(event) => { setQueryText(event.target.value); setError(null) }} placeholder={'SELECT * FROM public."Updates" LIMIT 10;'} rows={10} spellCheck={false} autoFocus />
        {queryConfirm && <div className="pg-query-warning">This query may change database objects or data. Click Run again to confirm execution.</div>}
        {error && <div className="pg-error">{error}</div>}
        {queryResult && <div className="pg-query-result"><div className="pg-query-meta">{queryResult.command} · {queryResult.rowCount} affected/returned</div>{queryResult.columns.length > 0 && <div className="pg-query-table-wrap"><table><thead><tr>{queryResult.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{queryResult.rows.map((row, index) => <tr key={index}>{queryResult.columns.map((column) => <td key={column}>{displayValue(row[column])}</td>)}</tr>)}</tbody></table></div>}</div>}
      </div>
      <footer className="pg-dialog-footer"><button className="pg-secondary" onClick={() => setQueryOpen(false)}>Close</button><button className="pg-primary" onClick={() => void runQuery()} disabled={queryRunning || !queryText.trim()}>{queryRunning ? 'Running…' : queryConfirm ? 'Confirm run' : 'Run query'}</button></footer>
    </div></div>}
    {editor && details && selectedTable && <RecordEditor table={selectedTable} details={details} mode={editor} initial={editor === 'edit' ? selectedRow ?? undefined : undefined} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void refresh() }} />}
    {deleting && details && <div className="pg-overlay" onClick={() => setDeleting(null)}><div className="pg-confirm" onClick={(event) => event.stopPropagation()}><h2>Delete row?</h2><p>This permanently deletes the selected row.</p><JsonHighlight json={JSON.stringify(Object.fromEntries(rowIdentity.filter((key) => key !== '__sws_ctid').map((key) => [key, deleting[key]])), null, 2)} /><footer className="pg-dialog-footer"><button className="pg-secondary" onClick={() => setDeleting(null)}>Cancel</button><button className="pg-danger" onClick={() => { setDeleting(null); void deleteRow(deleting, false) }}>Delete</button></footer></div></div>}
    {truncating && selectedTable && <div className="pg-overlay" onClick={() => setTruncating(false)}><div className="pg-confirm" onClick={(event) => event.stopPropagation()}><h2>Truncate table?</h2><p>This permanently deletes every row from <strong>{displayTable(selectedTable)}</strong>.</p><footer className="pg-dialog-footer"><button className="pg-secondary" onClick={() => setTruncating(false)}>Cancel</button><button className="pg-danger" onClick={() => void truncate()}>Truncate table</button></footer></div></div>}

    <header className="pg-header"><div><h1>PostgreSQL</h1><p>Browse and manage tables across user schemas.</p></div><div className="pg-header-actions"><select className="pg-database-select" value={database} onChange={(event) => void changeDatabase(event.target.value)} aria-label="PostgreSQL database">{databases.map((name) => <option key={name} value={name}>{name}</option>)}</select><button className="pg-primary" onClick={() => setQueryOpen(true)}>Run a query</button><button className="pg-icon" onClick={() => void refresh()} disabled={loading} title="Refresh" aria-label="Refresh">↻</button></div></header>
    {error && <div className="pg-error">{error}</div>}
    <div className="pg-workspace">
      <aside className="pg-table-list"><div className="pg-table-list-title">Tables <span>{tables.length}</span></div>{tables.length === 0 ? <div className="pg-empty">No tables found.</div> : tables.map((table) => <button className={`pg-table-item${selectedTable?.schema === table.schema && selectedTable.name === table.name ? ' active' : ''}`} key={`${table.schema}.${table.name}`} onClick={() => void selectTable(table)}><span>{displayTable(table)}</span><small>{table.count.toLocaleString()} records</small></button>)}<div className="pg-object-group"><strong>Views</strong>{objects.views.map((object) => <button key={`${object.schema}.${object.name}`} onClick={() => { setQueryName(`View ${object.name}`); setQueryText(object.definition); setQueryOpen(true) }}>{object.schema}.{object.name}</button>)}</div><div className="pg-object-group"><strong>Functions & Procedures</strong>{objects.routines.map((object) => <button key={`${object.schema}.${object.name}-${object.type}`} onClick={() => { setQueryName(`${object.type} ${object.name}`); setQueryText(object.definition ?? ''); setQueryOpen(true) }}>{object.schema}.{object.name}</button>)}</div></aside>
      <main className="pg-main">
        {!selectedTable ? <div className="pg-empty pg-main-empty">Select a table to view its description and data.</div> : details && <>
          <header className="pg-selected-header"><div><h2>{displayTable(selectedTable)}</h2><p>{details.count.toLocaleString()} records · {primaryKeys.length ? `Primary key: ${primaryKeys.join(', ')}` : 'Row identity: ctid'}</p></div><div className="pg-actions"><button className="pg-danger-outline" onClick={() => setTruncating(true)} disabled={loading}>Truncate</button><button className="pg-primary" onClick={() => setEditor('add')} disabled={!details}>Add row</button></div></header>
          <div className="pg-tabs" role="tablist"><button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')} role="tab" aria-selected={tab === 'data'}>Table Data</button><button className={tab === 'description' ? 'active' : ''} onClick={() => setTab('description')} role="tab" aria-selected={tab === 'description'}>Table Description</button></div>
          {tab === 'description' ? <div className="pg-description"><div className="pg-description-head"><span>Column</span><span>Type</span><span>Nullable</span><span>Default</span><span>Key</span></div>{details.columns.map((column) => <div className="pg-description-row" key={column.column_name}><code>{column.column_name}</code><span>{column.data_type}</span><span>{column.is_nullable}</span><code>{column.column_default ?? '—'}</code><strong>{column.is_primary ? 'PRIMARY KEY' : ''}</strong></div>)}</div> : <div className="pg-data-layout"><section className="pg-data"><div className="pg-data-head">{(details.columns.length ? details.columns : [{ column_name: 'No columns', data_type: '', is_nullable: '', column_default: null, is_primary: false }]).slice(0, 8).map((column) => <span key={column.column_name}>{column.column_name}</span>)}</div>{loading ? <div className="pg-empty">Loading rows…</div> : rows.length === 0 ? <div className="pg-empty">No rows found.</div> : rows.map((row, rowIndex) => <button className={`pg-row${selectedRow && rowKey(selectedRow, rowIdentity) === rowKey(row, rowIdentity) ? ' active' : ''}`} key={rowIdentity.length ? rowKey(row, rowIdentity) : `row-${rowIndex}`} onClick={() => setSelectedRow(row)} onContextMenu={(event) => { if (quickDelete) { event.preventDefault(); void deleteRow(row, false) } }}>{details.columns.slice(0, 8).map((column) => <span key={column.column_name}>{displayValue(row[column.column_name])}</span>)}</button>)}<footer className="pg-pagination"><button onClick={() => void loadRows(selectedTable, page - 1)} disabled={page === 0 || loading}>Previous</button><span>Page {page + 1}</span><button onClick={() => void loadRows(selectedTable, page + 1)} disabled={!hasNext || loading}>Next</button></footer></section><aside className="pg-row-detail">{selectedRow ? <><div className="pg-row-detail-head"><h3>Row detail</h3><div><button className="pg-secondary" onClick={() => setEditor('edit')} disabled={!rowIdentity.length}>Edit</button><button className="pg-danger-outline" onClick={() => void deleteRow(selectedRow, true)} disabled={!rowIdentity.length}>Delete</button></div></div><JsonHighlight json={JSON.stringify(visibleRow(selectedRow), null, 2)} /></> : <div className="pg-empty">Select a row to view details.</div>}</aside></div>}
        </>}
        {selectedRow && details && selectedTable && <div className="pg-inline-detail-panel"><div className="pg-inline-detail-head"><h3>Row detail</h3><div><button className="pg-secondary" onClick={() => setEditor('edit')} disabled={!rowIdentity.length}>Edit</button><button className="pg-danger-outline" onClick={() => void deleteRow(selectedRow, true)} disabled={!rowIdentity.length}>Delete</button></div></div><PostgresRowDetail table={selectedTable} details={details} row={selectedRow} onSaved={async (updated) => { setSelectedRow(updated); await refresh() }} /></div>}
        {selectedTable && details && (details.indexes?.length || details.triggers?.length) ? <div className="pg-object-detail-panel">
          {details.indexes && details.indexes.length > 0 && <section><h3>Indexes</h3>{details.indexes.map((index) => <button key={index.name} onClick={() => { setQueryName(`Index ${index.name}`); setQueryText(index.definition); setQueryOpen(true) }}>{index.name}</button>)}</section>}
          {details.triggers && details.triggers.length > 0 && <section><h3>Triggers</h3>{details.triggers.map((trigger) => <button key={trigger.name} onClick={() => { setQueryName(`Trigger ${trigger.name}`); setQueryText(trigger.definition); setQueryOpen(true) }}>{trigger.name} · {trigger.event}</button>)}</section>}
        </div> : null}
      </main>
    </div>
  </div>
}
