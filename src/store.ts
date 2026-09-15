export interface AppSettings {
  baseUrl: string
  defaultRegion: string
  dynamoBaseUrl: string
  dynamoRegion: string
  dynamoDefaultTable: string
  dynamoRefreshSeconds: number
  dynamoQuickDelete: boolean
  postgresHost: string
  postgresPort: number
  postgresDatabase: string
  postgresUser: string
  postgresPassword: string
  postgresRefreshSeconds: number
  postgresQuickDelete: boolean
  refreshSeconds: number
}

export interface TemplateCategory {
  id: string
  name: string
}

export interface JsonTemplate {
  id: string
  name: string
  description: string
  category: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface SavedQuery {
  id: string
  name: string
  sql: string
  updatedAt: string
}

const SETTINGS_KEY = 'sqs-monitor-settings'
const TEMPLATES_KEY = 'sqs-monitor-templates'
const CATEGORIES_KEY = 'sqs-monitor-template-categories'
const SAVED_QUERIES_KEY = 'sws-tools-postgres-queries'

export const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: 'http://localhost:9324',
  defaultRegion: 'eu-west-1',
  dynamoBaseUrl: 'http://localhost:9324',
  dynamoRegion: 'eu-west-1',
  dynamoDefaultTable: 'local-sws-public-ecu-update-spr-jobs',
  dynamoRefreshSeconds: 15,
  dynamoQuickDelete: false,
  postgresHost: 'localhost',
  postgresPort: 5432,
  postgresDatabase: 'ecu-update-db',
  postgresUser: 'postgres',
  postgresPassword: '',
  postgresRefreshSeconds: 0,
  postgresQuickDelete: false,
  refreshSeconds: 15,
}

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  // Hot-update the Vite dev-server proxy target (fire-and-forget, no-op in production)
  fetch('/_sqs_config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: settings.baseUrl }),
  }).catch(() => { /* silently ignore outside dev server */ })
  fetch('/_dynamo_config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: settings.dynamoBaseUrl }),
  }).catch(() => { /* silently ignore outside dev server */ })
  fetch('/_postgres_config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: settings.postgresHost,
      port: settings.postgresPort,
      database: settings.postgresDatabase,
      user: settings.postgresUser,
      password: settings.postgresPassword,
    }),
  }).catch(() => { /* silently ignore outside dev server */ })
}

export function getTemplates(): JsonTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as JsonTemplate[]
    return parsed.map((t) => ({ ...t, category: t.category ?? '' }))
  } catch {
    return []
  }
}

export function saveTemplates(templates: JsonTemplate[]): void {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates))
}

export function getCategories(): TemplateCategory[] {
  try {
    const raw = localStorage.getItem(CATEGORIES_KEY)
    if (!raw) return []
    return JSON.parse(raw) as TemplateCategory[]
  } catch {
    return []
  }
}

export function saveCategories(categories: TemplateCategory[]): void {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories))
}

export function getSavedQueries(): SavedQuery[] {
  try {
    const raw = localStorage.getItem(SAVED_QUERIES_KEY)
    return raw ? JSON.parse(raw) as SavedQuery[] : []
  } catch { return [] }
}

export function saveSavedQueries(queries: SavedQuery[]): void {
  localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(queries))
}

export async function loadFromServer(): Promise<{ templates: JsonTemplate[]; categories: TemplateCategory[] } | null> {
  try {
    const res = await fetch('/_sqs_data')
    if (!res.ok) return null
    const data = await res.json()
    return {
      templates: Array.isArray(data.templates)
        ? (data.templates as JsonTemplate[]).map((t) => ({ ...t, category: t.category ?? '' }))
        : [],
      categories: Array.isArray(data.categories) ? (data.categories as TemplateCategory[]) : [],
    }
  } catch {
    return null
  }
}

export function pushToServer(templates: JsonTemplate[], categories: TemplateCategory[]): void {
  fetch('/_sqs_data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templates, categories }),
  }).catch(() => { /* fire-and-forget, no-op in production build */ })
}
