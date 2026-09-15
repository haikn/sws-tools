import { useEffect, useRef, useState } from 'react'
import { getTemplates, saveTemplates, getCategories, saveCategories, loadFromServer, pushToServer } from './store'
import type { JsonTemplate, TemplateCategory } from './store'
import JsonHighlight from './JsonHighlight'
import './TemplatesPage.css'

type EditingTemplate = Omit<JsonTemplate, 'id' | 'createdAt' | 'updatedAt'>

function validateJson(text: string): string | null {
  if (!text.trim()) return 'JSON content is required.'
  try { JSON.parse(text); return null }
  catch (e) { return e instanceof Error ? e.message : 'Invalid JSON' }
}

function formatJson(text: string): string {
  return JSON.stringify(JSON.parse(text), null, '\t')
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
}

interface EditorProps {
  initial: EditingTemplate
  onSave: (t: EditingTemplate) => void
  onCancel: () => void
  isNew: boolean
  categories: TemplateCategory[]
}

function TemplateEditor({ initial, onSave, onCancel, isNew, categories }: EditorProps) {
  const [form, setForm] = useState<EditingTemplate>(initial)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function setContent(value: string) {
    setForm((f) => ({ ...f, content: value }))
    setJsonError(validateJson(value))
  }

  function set<K extends keyof EditingTemplate>(key: K, value: EditingTemplate[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleTabKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = e.currentTarget
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = form.content.substring(0, start) + '\t' + form.content.substring(end)
    setContent(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 1
    })
  }

  function handleFormat() {
    const err = validateJson(form.content)
    if (err) { setJsonError(err); return }
    setContent(formatJson(form.content))
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? ''
      try {
        setContent(formatJson(text))
      } catch {
        setContent(text)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleSave() {
    if (!form.name.trim()) return
    const err = validateJson(form.content)
    if (err) { setJsonError(err); return }
    onSave({ ...form, content: formatJson(form.content) })
  }

  const canSave = form.name.trim().length > 0 && !jsonError && form.content.trim().length > 0

  return (
    <div className="tp-editor">
      <div className="tp-editor-header">
        <h2>{isNew ? 'New Template' : 'Edit Template'}</h2>
      </div>

      <div className="tp-editor-body">
        <div className="tp-field">
          <label className="tp-label">Name <span className="tp-required">*</span></label>
          <input
            className="tp-input"
            type="text"
            placeholder="e.g. Software Update Event"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            autoFocus
          />
        </div>

        <div className="tp-field">
          <label className="tp-label">Description</label>
          <input
            className="tp-input"
            type="text"
            placeholder="Optional description"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        <div className="tp-field">
          <label className="tp-label">Category</label>
          <select
            className="tp-select"
            value={form.category}
            onChange={(e) => set('category', e.target.value)}
          >
            <option value="">— No category —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="tp-field">
          <div className="tp-label-row">
            <label className="tp-label">JSON Content <span className="tp-required">*</span></label>
            <div className="tp-label-actions">
              <button
                type="button"
                className="tp-btn-format"
                onClick={handleFormat}
                disabled={!form.content.trim()}
                title="Format with tab indentation"
              >
                Format
              </button>
              <label className="tp-browse-btn">
                Browse file…
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json,text/plain"
                  style={{ display: 'none' }}
                  onChange={handleFile}
                />
              </label>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            className={`tp-textarea${jsonError ? ' tp-textarea--error' : ''}`}
            placeholder={'{\n\t"event": "update",\n\t"id": 123\n}'}
            value={form.content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleTabKey}
            rows={16}
            spellCheck={false}
            autoComplete="off"
          />
          {jsonError && <div className="tp-json-error">{jsonError}</div>}
          {!jsonError && form.content.trim() && (
            <div className="tp-json-ok">Valid JSON</div>
          )}
        </div>
      </div>

      <div className="tp-editor-footer">
        <button className="tp-btn-cancel" onClick={onCancel}>Cancel</button>
        <button className="tp-btn-save" onClick={handleSave} disabled={!canSave}>
          {isNew ? 'Create Template' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

interface CategoryManagerProps {
  categories: TemplateCategory[]
  onAdd: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

function CategoryManager({ categories, onAdd, onRename, onDelete, onClose }: CategoryManagerProps) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  function startEdit(c: TemplateCategory) {
    setEditingId(c.id)
    setEditName(c.name)
  }

  function commitEdit(id: string) {
    const trimmed = editName.trim()
    if (trimmed) onRename(id, trimmed)
    setEditingId(null)
  }

  function handleAdd() {
    const trimmed = newName.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setNewName('')
  }

  return (
    <div className="tp-confirm-overlay" onClick={onClose}>
      <div className="tp-cat-manager" onClick={(e) => e.stopPropagation()}>
        <div className="tp-cat-manager-header">
          <h3>Manage Categories</h3>
          <button className="tp-cat-manager-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {categories.length === 0 ? (
          <p className="tp-cat-manager-empty">No categories yet. Add one below.</p>
        ) : (
          <ul className="tp-cat-list">
            {categories.map((c) => (
              <li key={c.id} className="tp-cat-item">
                {editingId === c.id ? (
                  <input
                    className="tp-input tp-cat-edit-input"
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => commitEdit(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit(c.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                ) : (
                  <span className="tp-cat-item-name">{c.name}</span>
                )}
                <div className="tp-cat-item-actions">
                  {editingId !== c.id && (
                    <button className="tp-btn-expand" onClick={() => startEdit(c)}>Rename</button>
                  )}
                  <button className="tp-btn-del" onClick={() => onDelete(c.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="tp-cat-add">
          <input
            className="tp-input"
            placeholder="New category name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
          />
          <button className="tp-btn-new" onClick={handleAdd} disabled={!newName.trim()}>Add</button>
        </div>

        <div className="tp-cat-manager-footer">
          <button className="tp-btn-save" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<JsonTemplate[]>(getTemplates)
  const [categories, setCategories] = useState<TemplateCategory[]>(getCategories)
  const [editing, setEditing] = useState<JsonTemplate | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showCatManager, setShowCatManager] = useState(false)
  const initializedRef = useRef(false)

  // Restore from server file on mount (survives browser localStorage clearing)
  useEffect(() => {
    loadFromServer().then((data) => {
      if (data) {
        setTemplates(data.templates)
        saveTemplates(data.templates)
        setCategories(data.categories)
        saveCategories(data.categories)
      }
      initializedRef.current = true
    })
  }, [])

  // Push to server whenever data changes (after initial load)
  useEffect(() => {
    if (!initializedRef.current) return
    pushToServer(templates, categories)
  }, [templates, categories])

  function handleCopy(id: string, content: string) {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000)
    })
  }

  function persist(updated: JsonTemplate[]) {
    setTemplates(updated)
    saveTemplates(updated)
  }

  function persistCategories(updated: TemplateCategory[]) {
    setCategories(updated)
    saveCategories(updated)
  }

  function handleNew() {
    setEditing({ id: '', name: '', description: '', category: activeCategory ?? '', content: '', createdAt: '', updatedAt: '' })
    setIsNew(true)
  }

  function handleEdit(t: JsonTemplate) {
    setEditing(t)
    setIsNew(false)
  }

  function handleSaveNew(form: EditingTemplate) {
    const now = new Date().toISOString()
    persist([...templates, {
      id: `tpl_${Date.now()}`,
      name: form.name.trim(),
      description: form.description.trim(),
      category: form.category,
      content: form.content,
      createdAt: now,
      updatedAt: now,
    }])
    setEditing(null)
  }

  function handleSaveEdit(form: EditingTemplate) {
    if (!editing) return
    persist(templates.map((t) =>
      t.id === editing.id
        ? { ...t, name: form.name.trim(), description: form.description.trim(), category: form.category, content: form.content, updatedAt: new Date().toISOString() }
        : t
    ))
    setEditing(null)
  }

  function handleDelete(id: string) {
    persist(templates.filter((t) => t.id !== id))
    setDeleteId(null)
    if (editing?.id === id) setEditing(null)
  }

  function handleAddCategory(name: string) {
    persistCategories([...categories, { id: `cat_${Date.now()}`, name }])
  }

  function handleRenameCategory(id: string, name: string) {
    persistCategories(categories.map((c) => c.id === id ? { ...c, name } : c))
  }

  function handleDeleteCategory(id: string) {
    persistCategories(categories.filter((c) => c.id !== id))
    persist(templates.map((t) => t.category === id ? { ...t, category: '' } : t))
    if (activeCategory === id) setActiveCategory(null)
  }

  const visibleTemplates = activeCategory === null
    ? templates
    : templates.filter((t) => t.category === activeCategory)

  const catMap = new Map(categories.map((c) => [c.id, c.name]))

  if (editing !== null) {
    return (
      <div className="page">
        <TemplateEditor
          initial={{ name: editing.name, description: editing.description, category: editing.category, content: editing.content }}
          onSave={isNew ? handleSaveNew : handleSaveEdit}
          onCancel={() => setEditing(null)}
          isNew={isNew}
          categories={categories}
        />
      </div>
    )
  }

  return (
    <div className="page">
      {showCatManager && (
        <CategoryManager
          categories={categories}
          onAdd={handleAddCategory}
          onRename={handleRenameCategory}
          onDelete={handleDeleteCategory}
          onClose={() => setShowCatManager(false)}
        />
      )}

      {deleteId && (
        <div className="tp-confirm-overlay" onClick={() => setDeleteId(null)}>
          <div className="tp-confirm" onClick={(e) => e.stopPropagation()}>
            <h3>Delete template?</h3>
            <p>This cannot be undone.</p>
            <div className="tp-confirm-actions">
              <button className="tp-btn-cancel" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="tp-btn-delete" onClick={() => handleDelete(deleteId)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">JSON Templates</h1>
        <div className="tp-header-actions">
          <button className="tp-btn-categories" onClick={() => setShowCatManager(true)}>Categories</button>
          <button className="tp-btn-new" onClick={handleNew}>+ New Template</button>
        </div>
      </div>

      {categories.length > 0 && (
        <div className="tp-cat-bar">
          <button
            className={`tp-cat-tab${activeCategory === null ? ' tp-cat-tab--active' : ''}`}
            onClick={() => setActiveCategory(null)}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`tp-cat-tab${activeCategory === c.id ? ' tp-cat-tab--active' : ''}`}
              onClick={() => setActiveCategory(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {visibleTemplates.length === 0 ? (
        <div className="tp-empty">
          <div className="tp-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <p>{activeCategory !== null ? 'No templates in this category.' : 'No templates yet. Create one to quickly send pre-defined messages.'}</p>
          <button className="tp-btn-new" onClick={handleNew}>+ New Template</button>
        </div>
      ) : (
        <div className="tp-list">
          {visibleTemplates.map((t) => (
            <div key={t.id} className="tp-card">
              <div className="tp-card-header">
                <div className="tp-card-info">
                  <div className="tp-card-title-row">
                    <span className="tp-card-name">{t.name}</span>
                    {t.category && catMap.has(t.category) && (
                      <span className="tp-cat-badge">{catMap.get(t.category)}</span>
                    )}
                  </div>
                  {t.description && <span className="tp-card-desc">{t.description}</span>}
                </div>
                <div className="tp-card-actions">
                  <button
                    className="tp-btn-expand"
                    onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                  >
                    {expanded === t.id ? 'Hide' : 'Preview'}
                  </button>
                  <button className="tp-btn-edit" onClick={() => handleEdit(t)}>Edit</button>
                  <button className="tp-btn-del" onClick={() => setDeleteId(t.id)}>Delete</button>
                </div>
              </div>
              {expanded === t.id && (
                <div className="tp-preview-wrap">
                  <div className="tp-preview-toolbar">
                    <button
                      className={`tp-btn-copy${copiedId === t.id ? ' tp-btn-copy--done' : ''}`}
                      onClick={() => handleCopy(t.id, t.content)}
                    >
                      {copiedId === t.id ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <JsonHighlight json={t.content} className="tp-preview-hl" />
                </div>
              )}
              <div className="tp-card-meta">
                Updated {formatDate(t.updatedAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
