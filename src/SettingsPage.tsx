import { useState } from 'react'
import { getSettings, saveSettings, DEFAULT_SETTINGS } from './store'
import type { AppSettings } from './store'
import { isExtensionWebview, requestBackend } from './platformApi'
import './SettingsPage.css'

const REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-south-1',
  'sa-east-1', 'ca-central-1',
]

interface Props {
  onSaved: () => void
}

export default function SettingsPage({ onSaved }: Props) {
  const [activeTab, setActiveTab] = useState<'sqs' | 'postgres' | 'dynamodb'>('sqs')
  const [form, setForm] = useState<AppSettings>(getSettings)
  const [saved, setSaved] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [dynamoUrlError, setDynamoUrlError] = useState<string | null>(null)

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
    if (key === 'baseUrl') setUrlError(null)
    if (key === 'dynamoBaseUrl') setDynamoUrlError(null)
  }

  function validateUrl(url: string): string | null {
    try {
      const u = new URL(url)
      if (!['http:', 'https:'].includes(u.protocol)) return 'URL must use http or https'
      return null
    } catch {
      return 'Invalid URL format'
    }
  }

  async function handleSave() {
    const err = validateUrl(form.baseUrl)
    if (err) { setUrlError(err); return }
    const dynamoErr = validateUrl(form.dynamoBaseUrl)
    if (dynamoErr) { setDynamoUrlError(dynamoErr); return }
    try {
      if (isExtensionWebview()) {
        if (form.postgresPassword) {
          await requestBackend('/_extension_settings', { action: 'setPostgresPassword', password: form.postgresPassword })
        }
        saveSettings({ ...form, postgresPassword: '' })
      } else {
        saveSettings(form)
      }
      setSaved(true)
      onSaved()
    } catch (saveError) {
      setDynamoUrlError(saveError instanceof Error ? saveError.message : String(saveError))
    }
  }

  function handleReset() {
    setForm({ ...DEFAULT_SETTINGS })
    setSaved(false)
    setUrlError(null)
    setDynamoUrlError(null)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="sp-tabs" role="tablist" aria-label="Settings components">
        <button className={activeTab === 'sqs' ? 'active' : ''} onClick={() => setActiveTab('sqs')} role="tab" aria-selected={activeTab === 'sqs'}>SQS</button>
        <button className={activeTab === 'postgres' ? 'active' : ''} onClick={() => setActiveTab('postgres')} role="tab" aria-selected={activeTab === 'postgres'}>PostgreSQL</button>
        <button className={activeTab === 'dynamodb' ? 'active' : ''} onClick={() => setActiveTab('dynamodb')} role="tab" aria-selected={activeTab === 'dynamodb'}>DynamoDB</button>
      </div>

      {activeTab === 'dynamodb' && <div className="sp-card">
        <div className="sp-section-title">DynamoDB Connection</div>

        <div className="sp-field">
          <label className="sp-label">DynamoDB Base URL</label>
          <p className="sp-hint">LocalStack endpoint used for DynamoDB API calls.</p>
          <input
            className={`sp-input${dynamoUrlError ? ' sp-input--error' : ''}`}
            type="text"
            value={form.dynamoBaseUrl}
            onChange={(e) => set('dynamoBaseUrl', e.target.value)}
            placeholder="http://localhost:9324"
            spellCheck={false}
          />
          {dynamoUrlError && <div className="sp-field-error">{dynamoUrlError}</div>}
          <div className="sp-example">
            Example command: <code>aws --endpoint-url {form.dynamoBaseUrl || 'http://localhost:9324'} dynamodb list-tables</code>
          </div>
        </div>

        <div className="sp-field">
          <label className="sp-label">DynamoDB Region</label>
          <p className="sp-hint">Region used to sign LocalStack DynamoDB requests.</p>
          <select className="sp-select" value={form.dynamoRegion} onChange={(e) => set('dynamoRegion', e.target.value)}>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className="sp-field">
          <label className="sp-label">Default DynamoDB Table</label>
          <p className="sp-hint">Selected automatically when the table is available.</p>
          <input className="sp-input" type="text" value={form.dynamoDefaultTable} onChange={(e) => set('dynamoDefaultTable', e.target.value)} placeholder="Optional table name" spellCheck={false} />
        </div>

        <div className="sp-field">
          <label className="sp-label">DynamoDB Auto-refresh</label>
          <p className="sp-hint">Reload the selected table from page 1. Use 0 to disable.</p>
          <div className="sp-input-row">
            <input className="sp-input sp-input--narrow" type="number" min={0} max={300} value={form.dynamoRefreshSeconds} onChange={(e) => set('dynamoRefreshSeconds', Math.max(0, Math.min(300, Number(e.target.value))))} />
            <span className="sp-unit">seconds</span>
          </div>
        </div>

        <div className="sp-field">
          <label className="sp-toggle"><input type="checkbox" checked={form.dynamoQuickDelete} onChange={(e) => set('dynamoQuickDelete', e.target.checked)} /><span><strong>Quick Delete</strong><small>Right-click a row to delete immediately without confirmation.</small></span></label>
        </div>
      </div>}

      {activeTab === 'sqs' && <>
      <div className="sp-card">
        <div className="sp-section-title">Connection</div>

        <div className="sp-field">
          <label className="sp-label">SQS Base URL</label>
          <p className="sp-hint">Endpoint used for all SQS API calls (e.g. your LocalStack instance).</p>
          <input
            className={`sp-input${urlError ? ' sp-input--error' : ''}`}
            type="text"
            value={form.baseUrl}
            onChange={(e) => set('baseUrl', e.target.value)}
            placeholder="http://localhost:9324"
            spellCheck={false}
          />
          {urlError && <div className="sp-field-error">{urlError}</div>}
          <div className="sp-example">
            Example command: <code>aws --endpoint-url {form.baseUrl || 'http://localhost:9324'} sqs list-queues</code>
          </div>
        </div>

        <div className="sp-field">
          <label className="sp-label">Default Region</label>
          <p className="sp-hint">Applied on startup and when settings are saved.</p>
          <select
            className="sp-select"
            value={form.defaultRegion}
            onChange={(e) => set('defaultRegion', e.target.value)}
          >
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="sp-card">
        <div className="sp-section-title">Queue Monitor</div>

        <div className="sp-field">
          <label className="sp-label">Auto-refresh interval</label>
          <p className="sp-hint">How often the queue list refreshes automatically (in seconds).</p>
          <div className="sp-input-row">
            <input
              className="sp-input sp-input--narrow"
              type="number"
              min={5}
              max={300}
              value={form.refreshSeconds}
              onChange={(e) => set('refreshSeconds', Math.max(5, Math.min(300, Number(e.target.value))))}
            />
            <span className="sp-unit">seconds</span>
          </div>
          <div className="sp-range-labels">
            <span>Min: 5s</span><span>Max: 300s</span>
          </div>
        </div>
      </div>
      </>}

      {activeTab === 'postgres' && <div className="sp-card">
        <div className="sp-section-title">PostgreSQL</div>
        <div className="sp-field">
          <label className="sp-label">Host</label>
          <input className="sp-input" value={form.postgresHost} onChange={(e) => set('postgresHost', e.target.value)} placeholder="localhost" />
        </div>
        <div className="sp-field">
          <label className="sp-label">Port</label>
          <input className="sp-input sp-input--narrow" type="number" min={1} max={65535} value={form.postgresPort} onChange={(e) => set('postgresPort', Number(e.target.value))} />
        </div>
        <div className="sp-field">
          <label className="sp-label">Database</label>
          <input className="sp-input" value={form.postgresDatabase} onChange={(e) => set('postgresDatabase', e.target.value)} placeholder="ecu-update-db" />
        </div>
        <div className="sp-field">
          <label className="sp-label">Username</label>
          <input className="sp-input" value={form.postgresUser} onChange={(e) => set('postgresUser', e.target.value)} placeholder="postgres" />
        </div>
        <div className="sp-field">
          <label className="sp-label">Password</label>
          <input className="sp-input" type="password" value={form.postgresPassword} onChange={(e) => set('postgresPassword', e.target.value)} autoComplete="off" />
          <p className="sp-hint">Stored in browser local storage for this local development tool.</p>
        </div>
        <div className="sp-field">
          <label className="sp-label">Auto-refresh interval</label>
          <div className="sp-input-row"><input className="sp-input sp-input--narrow" type="number" min={0} max={300} value={form.postgresRefreshSeconds} onChange={(e) => set('postgresRefreshSeconds', Math.max(0, Math.min(300, Number(e.target.value))))} /><span className="sp-unit">seconds (0 disables)</span></div>
        </div>
        <div className="sp-field">
          <label className="sp-toggle"><input type="checkbox" checked={form.postgresQuickDelete} onChange={(e) => set('postgresQuickDelete', e.target.checked)} /><span><strong>Quick Delete</strong><small>Right-click a row to delete immediately without confirmation.</small></span></label>
        </div>
      </div>}

      <div className="sp-actions">
        <button className="sp-btn-reset" onClick={handleReset}>Reset to defaults</button>
        <button className="sp-btn-save" onClick={handleSave}>Save Settings</button>
      </div>

      {saved && (
        <div className="sp-saved">Settings saved. Changes will apply immediately.</div>
      )}
    </div>
  )
}
