import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'
import https from 'node:https'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'
const { Pool } = pg

// ─── Persisted config ─────────────────────────────────────────────────────────
const CONFIG_FILE = './sqs-config.json'
const DATA_FILE = './sqs-data.json'
let sqsTarget = 'http://localhost:9324'
let dynamoTarget = 'http://localhost:9324'
let postgresPool: pg.Pool | null = null
let postgresConfig: { host: string; port: number; database: string; user: string; password: string } | null = null
try {
  if (existsSync(CONFIG_FILE)) {
    const saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    if (typeof saved.baseUrl === 'string' && saved.baseUrl) sqsTarget = saved.baseUrl
    if (typeof saved.dynamoBaseUrl === 'string' && saved.dynamoBaseUrl) dynamoTarget = saved.dynamoBaseUrl
  }
} catch { /* use default */ }

function saveTargets() {
  try { writeFileSync(CONFIG_FILE, JSON.stringify({ baseUrl: sqsTarget, dynamoBaseUrl: dynamoTarget }, null, 2)) } catch { /* */ }
}

function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse, targetUrl: string) {
  const path = req.url ?? '/'
  let target: URL
  try { target = new URL(path, targetUrl) } catch {
    res.writeHead(400); res.end('Bad proxy target'); return
  }

  const isSecure = target.protocol === 'https:'
  const mod = isSecure ? https : http
  const opts: http.RequestOptions = {
    hostname: target.hostname,
    port: Number(target.port) || (isSecure ? 443 : 80),
    path: target.pathname + target.search,
    method: req.method,
    headers: { ...req.headers, host: target.host },
  }
  delete (opts.headers as Record<string, string | undefined>).origin
  delete (opts.headers as Record<string, string | undefined>).referer

  const upstream = mod.request(opts, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers)
    upstreamRes.pipe(res, { end: true })
  })
  upstream.on('error', (err) => {
    if (!res.headersSent) res.writeHead(502)
    res.end(`Proxy error: ${err.message}`)
  })
  req.pipe(upstream, { end: true })
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Invalid table identifier')
  return `"${value}"`
}

function tableName(schemaValue: unknown, tableValue: unknown): string {
  if (typeof schemaValue !== 'string' || typeof tableValue !== 'string') throw new Error('Schema and table name are required')
  return `${quoteIdentifier(schemaValue)}.${quoteIdentifier(tableValue)}`
}

function safeJson(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(safeJson)
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, safeJson(entry)]))
  return value
}

function primaryKeys(columns: Array<{ column_name: string; is_primary: boolean }>): string[] {
  return columns.filter((column) => column.is_primary).map((column) => column.column_name)
}

async function postgresHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  res.setHeader('Content-Type', 'application/json')
  try {
    if (req.method !== 'POST') throw new Error('Method not allowed')
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    await new Promise<void>((resolve) => req.on('end', () => resolve()))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
    if (!postgresConfig) throw new Error('PostgreSQL is not configured. Save PostgreSQL settings first.')
    if (!postgresPool) postgresPool = new Pool(postgresConfig)
    const pool = postgresPool
    const action = body.action
    if (action === 'databases') {
      const result = await pool.query(`SELECT datname AS name FROM pg_database WHERE datallowconn = true AND NOT datistemplate ORDER BY datname`)
      res.end(JSON.stringify({ databases: result.rows.map((row) => row.name) }))
      return
    }
    if (action === 'executeQuery') {
      const sql = typeof body.sql === 'string' ? body.sql.trim() : ''
      if (!sql) throw new Error('SQL query is required.')
      if (sql.replace(/'[^']*'/g, '').split(';').filter((part) => part.trim()).length > 1) throw new Error('Run one SQL statement at a time.')
      const result = await pool.query(sql)
      res.end(JSON.stringify({ columns: result.fields.map((field) => field.name), rows: result.rows.map(safeJson), rowCount: result.rowCount ?? 0, command: result.command }))
      return
    }
    if (action === 'tables') {
      const result = await pool.query(`SELECT t.table_schema, t.table_name
        FROM information_schema.tables t
        WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema') AND t.table_schema NOT LIKE 'pg_toast%' AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_schema, t.table_name`)
      const tables = await Promise.all(result.rows.map(async (row) => {
        const relation = `${quoteIdentifier(row.table_schema)}.${quoteIdentifier(row.table_name)}`
        const countResult = await pool.query(`SELECT COUNT(*)::bigint AS count FROM ${relation}`)
        return { schema: row.table_schema, name: row.table_name, count: Number(countResult.rows[0].count) }
      }))
      res.end(JSON.stringify({ tables }))
      return
    }

    if (action === 'objects') {
      const [views, routines] = await Promise.all([
        pool.query(`SELECT table_schema AS schema, table_name AS name, view_definition AS definition FROM information_schema.views WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name`),
        pool.query(`SELECT routine_schema AS schema, routine_name AS name, routine_type AS type, routine_definition AS definition FROM information_schema.routines WHERE routine_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY routine_schema, routine_name`),
      ])
      res.end(JSON.stringify({ views: views.rows, routines: routines.rows }))
      return
    }

    const table = tableName(body.schema, body.table)
    if (action === 'describe') {
      const result = await pool.query(`SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default,
        EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          JOIN pg_class pc ON pc.oid = i.indrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
          WHERE pn.nspname = c.table_schema AND pc.relname = c.table_name AND i.indisprimary AND a.attname = c.column_name) AS is_primary
        FROM information_schema.columns c WHERE c.table_schema = $1 AND c.table_name = $2 ORDER BY c.ordinal_position`, [body.schema, body.table])
      const count = await pool.query(`SELECT COUNT(*)::bigint AS count FROM ${table}`)
      const keys = primaryKeys(result.rows)
      const indexes = await pool.query(`SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`, [body.schema, body.table])
      const triggers = await pool.query(`SELECT trigger_name AS name, event_manipulation AS event, action_statement AS definition FROM information_schema.triggers WHERE event_object_schema = $1 AND event_object_table = $2 ORDER BY trigger_name`, [body.schema, body.table])
      res.end(JSON.stringify({ columns: result.rows, count: Number(count.rows[0].count), primaryKeys: keys, rowIdentity: keys.length ? keys : ['__sws_ctid'], indexes: indexes.rows, triggers: triggers.rows }))
      return
    }
    if (action === 'rows') {
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 10))
      const offset = Math.max(0, Number(body.offset) || 0)
      const order = Array.isArray(body.orderBy) && body.orderBy.length ? body.orderBy.map((key) => quoteIdentifier(String(key))).join(', ') : 'ctid'
      const result = await pool.query(`SELECT ctid::text AS __sws_ctid, * FROM ${table} ORDER BY ${order} LIMIT $1 OFFSET $2`, [limit, offset])
      res.end(JSON.stringify({ rows: result.rows.map(safeJson), hasNext: result.rows.length === limit }))
      return
    }
    const record = body.record && typeof body.record === 'object' ? body.record as Record<string, unknown> : {}
    const keys = body.keys && typeof body.keys === 'object' ? body.keys as Record<string, unknown> : {}
    if (action === 'insert') {
      const names = Object.keys(record)
      if (!names.length) throw new Error('Record cannot be empty')
      await pool.query(`INSERT INTO ${table} (${names.map(quoteIdentifier).join(', ')}) VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')})`, names.map((name) => record[name]))
    } else if (action === 'update') {
      const keyNames = Object.keys(keys)
      const values = Object.keys(record)
      if (!keyNames.length) throw new Error('A row identity is required for updates.')
      const setNames = values.filter((name) => !keyNames.includes(name))
      if (!setNames.length) throw new Error('No non-key columns to update.')
      const params = [...setNames.map((name) => record[name]), ...keyNames.map((name) => keys[name])]
      const whereStart = setNames.length
      const where = keyNames.length === 1 && keyNames[0] === '__sws_ctid' ? `ctid = $${whereStart + 1}::tid` : keyNames.map((name, index) => `${quoteIdentifier(name)} = $${whereStart + index + 1}`).join(' AND ')
      await pool.query(`UPDATE ${table} SET ${setNames.map((name, index) => `${quoteIdentifier(name)} = $${index + 1}`).join(', ')} WHERE ${where}`, params)
    } else if (action === 'delete') {
      const keyNames = Object.keys(keys)
      if (!keyNames.length) throw new Error('A row identity is required for deletes.')
      const where = keyNames.length === 1 && keyNames[0] === '__sws_ctid' ? 'ctid = $1::tid' : keyNames.map((name, index) => `${quoteIdentifier(name)} = $${index + 1}`).join(' AND ')
      await pool.query(`DELETE FROM ${table} WHERE ${where}`, keyNames.map((name) => keys[name]))
    } else if (action === 'truncate') {
      await pool.query(`TRUNCATE TABLE ${table}`)
    } else {
      throw new Error('Unknown PostgreSQL action')
    }
    res.end(JSON.stringify({ ok: true }))
  } catch (error) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}

interface SqsData { templates: unknown[]; categories: unknown[] }
let sqsData: SqsData = { templates: [], categories: [] }
try {
  if (existsSync(DATA_FILE)) {
    const saved = JSON.parse(readFileSync(DATA_FILE, 'utf8'))
    sqsData = { templates: saved.templates ?? [], categories: saved.categories ?? [] }
  }
} catch { /* use defaults */ }

// ─── Vite config ──────────────────────────────────────────────────────────────
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'sqs-dev-proxy',
      configureServer(server) {

        // /_sqs_data — templates + categories, persisted to sqs-data.json
        server.middlewares.use('/_sqs_data', (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          if (req.method === 'GET') {
            res.end(JSON.stringify(sqsData))
          } else if (req.method === 'POST') {
            const chunks: Buffer[] = []
            req.on('data', (c: Buffer) => chunks.push(c))
            req.on('end', () => {
              try {
                const body = JSON.parse(Buffer.concat(chunks).toString())
                if (Array.isArray(body.templates)) sqsData.templates = body.templates
                if (Array.isArray(body.categories)) sqsData.categories = body.categories
                try { writeFileSync(DATA_FILE, JSON.stringify(sqsData, null, 2)) } catch { /* */ }
                res.end(JSON.stringify({ ok: true }))
              } catch {
                res.statusCode = 400
                res.end('{"error":"invalid body"}')
              }
            })
          } else {
            res.statusCode = 405
            res.end('{"error":"method not allowed"}')
          }
        })

        // /_sqs_config — runtime config update (base URL, persisted to file)
        server.middlewares.use('/_sqs_config', (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          if (req.method === 'POST') {
            const chunks: Buffer[] = []
            req.on('data', (c: Buffer) => chunks.push(c))
            req.on('end', () => {
              try {
                const { baseUrl } = JSON.parse(Buffer.concat(chunks).toString())
                if (typeof baseUrl === 'string' && baseUrl) {
                  sqsTarget = baseUrl
                  saveTargets()
                }
                res.end(JSON.stringify({ ok: true, baseUrl: sqsTarget }))
              } catch {
                res.statusCode = 400
                res.end('{"error":"invalid body"}')
              }
            })
          } else {
            res.end(JSON.stringify({ baseUrl: sqsTarget }))
          }
        })

        server.middlewares.use('/_dynamo_config', (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          if (req.method === 'POST') {
            const chunks: Buffer[] = []
            req.on('data', (c: Buffer) => chunks.push(c))
            req.on('end', () => {
              try {
                const { baseUrl } = JSON.parse(Buffer.concat(chunks).toString())
                if (typeof baseUrl === 'string' && baseUrl) {
                  dynamoTarget = baseUrl
                  saveTargets()
                }
                res.end(JSON.stringify({ ok: true, baseUrl: dynamoTarget }))
              } catch {
                res.statusCode = 400
                res.end('{"error":"invalid body"}')
              }
            })
          } else {
            res.end(JSON.stringify({ baseUrl: dynamoTarget }))
          }
        })

        server.middlewares.use('/_postgres_config', (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          if (req.method !== 'POST') { res.end(JSON.stringify({ ok: true })); return }
          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer) => chunks.push(chunk))
          req.on('end', () => {
            try {
              const next = JSON.parse(Buffer.concat(chunks).toString())
              postgresPool?.end().catch(() => {})
              postgresPool = null
              postgresConfig = {
                host: String(next.host ?? 'localhost'),
                port: Number(next.port ?? 5432),
                database: String(next.database ?? ''),
                user: String(next.user ?? ''),
                password: String(next.password ?? ''),
              }
              res.end(JSON.stringify({ ok: true }))
            } catch (error) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
            }
          })
        })

        // /localstack — dynamic proxy to sqsTarget (browser → LocalStack)
        server.middlewares.use('/localstack', (req, res) => {
          proxyRequest(req, res, sqsTarget)
        })

        server.middlewares.use('/dynamodb', (req, res) => {
          proxyRequest(req, res, dynamoTarget)
        })

        server.middlewares.use('/_postgres', postgresHandler)
      },
    },
  ],
})
