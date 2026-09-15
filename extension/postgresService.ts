import pg from 'pg'
import { ExtensionSettingsService } from './extensionSettings.js'

const { Pool } = pg

type RequestBody = Record<string, unknown>
type ColumnInfo = { column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null; is_primary: boolean }

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Invalid table identifier')
  return `"${value}"`
}

function relation(schema: unknown, table: unknown): string {
  if (typeof schema !== 'string' || typeof table !== 'string') throw new Error('Schema and table name are required')
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]))
  return value
}

function primaryKeys(columns: ColumnInfo[]): string[] {
  return columns.filter((column) => column.is_primary).map((column) => column.column_name)
}

export class PostgresService {
  private pool: pg.Pool | null = null
  private connectionKey = ''

  constructor(private readonly settings: ExtensionSettingsService) {}

  async execute(body: RequestBody): Promise<unknown> {
    const client = await this.getPool()
    const action = body.action

    if (action === 'databases') {
      const result = await client.query(`SELECT datname AS name FROM pg_database WHERE datallowconn = true AND NOT datistemplate ORDER BY datname`)
      return { databases: result.rows.map((row) => row.name) }
    }

    if (action === 'executeQuery') {
      const sql = typeof body.sql === 'string' ? body.sql.trim() : ''
      if (!sql) throw new Error('SQL query is required.')
      if (sql.replace(/'[^']*'/g, '').split(';').filter((part) => part.trim()).length > 1) {
        throw new Error('Run one SQL statement at a time.')
      }
      const result = await client.query(sql)
      return { columns: result.fields.map((field) => field.name), rows: result.rows.map(jsonSafe), rowCount: result.rowCount ?? 0, command: result.command }
    }

    if (action === 'tables') {
      const result = await client.query(`SELECT t.table_schema, t.table_name
  FROM information_schema.tables t
  WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema') AND t.table_schema NOT LIKE 'pg_toast%' AND t.table_type = 'BASE TABLE'
  ORDER BY t.table_schema, t.table_name`)
      const tables = await Promise.all(result.rows.map(async (row) => {
        const countResult = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${relation(row.table_schema, row.table_name)}`)
        return { schema: row.table_schema, name: row.table_name, count: Number(countResult.rows[0].count) }
      }))
      return { tables }
    }

    if (action === 'objects') {
      const [views, routines] = await Promise.all([
        client.query(`SELECT table_schema AS schema, table_name AS name, view_definition AS definition FROM information_schema.views WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name`),
        client.query(`SELECT routine_schema AS schema, routine_name AS name, routine_type AS type, routine_definition AS definition FROM information_schema.routines WHERE routine_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY routine_schema, routine_name`),
      ])
      return { views: views.rows, routines: routines.rows }
    }

    const table = relation(body.schema, body.table)
    if (action === 'describe') {
      const result = await client.query(`SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default,
        EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          JOIN pg_class pc ON pc.oid = i.indrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
          WHERE pn.nspname = c.table_schema AND pc.relname = c.table_name AND i.indisprimary AND a.attname = c.column_name) AS is_primary
        FROM information_schema.columns c WHERE c.table_schema = $1 AND c.table_name = $2 ORDER BY c.ordinal_position`, [body.schema, body.table])
      const count = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${table}`)
      const keys = primaryKeys(result.rows)
      const indexes = await client.query(`SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`, [body.schema, body.table])
      const triggers = await client.query(`SELECT trigger_name AS name, event_manipulation AS event, action_statement AS definition FROM information_schema.triggers WHERE event_object_schema = $1 AND event_object_table = $2 ORDER BY trigger_name`, [body.schema, body.table])
      return { columns: result.rows, count: Number(count.rows[0].count), primaryKeys: keys, rowIdentity: keys.length ? keys : ['__sws_ctid'], indexes: indexes.rows, triggers: triggers.rows }
    }

    if (action === 'rows') {
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 10))
      const offset = Math.max(0, Number(body.offset) || 0)
      const order = Array.isArray(body.orderBy) && body.orderBy.length ? body.orderBy.map((key) => quoteIdentifier(String(key))).join(', ') : 'ctid'
      const result = await client.query(`SELECT ctid::text AS __sws_ctid, * FROM ${table} ORDER BY ${order} LIMIT $1 OFFSET $2`, [limit, offset])
      return { rows: result.rows.map(jsonSafe), hasNext: result.rows.length === limit }
    }

    const record = body.record && typeof body.record === 'object' ? body.record as Record<string, unknown> : {}
    const keys = body.keys && typeof body.keys === 'object' ? body.keys as Record<string, unknown> : {}
    if (action === 'insert') {
      const names = Object.keys(record)
      if (!names.length) throw new Error('Record cannot be empty')
      await client.query(`INSERT INTO ${table} (${names.map(quoteIdentifier).join(', ')}) VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')})`, names.map((name) => record[name]))
      return { ok: true }
    }
    if (action === 'update') {
      const keyNames = Object.keys(keys)
      if (!keyNames.length) throw new Error('A row identity is required for updates.')
      const setNames = Object.keys(record).filter((name) => !keyNames.includes(name))
      if (!setNames.length) throw new Error('No non-key columns to update.')
      const params = [...setNames.map((name) => record[name]), ...keyNames.map((name) => keys[name])]
      const whereStart = setNames.length
      const where = keyNames.length === 1 && keyNames[0] === '__sws_ctid' ? `ctid = $${whereStart + 1}::tid` : keyNames.map((name, index) => `${quoteIdentifier(name)} = $${whereStart + index + 1}`).join(' AND ')
      await client.query(`UPDATE ${table} SET ${setNames.map((name, index) => `${quoteIdentifier(name)} = $${index + 1}`).join(', ')} WHERE ${where}`, params)
      return { ok: true }
    }
    if (action === 'delete') {
      const keyNames = Object.keys(keys)
      if (!keyNames.length) throw new Error('A row identity is required for deletes.')
      const where = keyNames.length === 1 && keyNames[0] === '__sws_ctid' ? 'ctid = $1::tid' : keyNames.map((name, index) => `${quoteIdentifier(name)} = $${index + 1}`).join(' AND ')
      await client.query(`DELETE FROM ${table} WHERE ${where}`, keyNames.map((name) => keys[name]))
      return { ok: true }
    }
    if (action === 'truncate') {
      await client.query(`TRUNCATE TABLE ${table}`)
      return { ok: true }
    }
    throw new Error('Unknown PostgreSQL action')
  }

  async dispose(): Promise<void> {
    await this.pool?.end()
    this.pool = null
  }

  private async getPool(): Promise<pg.Pool> {
    const configuration = await this.settings.read()
    const password = await this.settings.getPostgresPassword()
    const key = JSON.stringify({ ...configuration, password })
    if (!this.pool || this.connectionKey !== key) {
      await this.pool?.end()
      this.pool = new Pool({
        host: configuration.postgresHost,
        port: configuration.postgresPort,
        database: configuration.postgresDatabase,
        user: configuration.postgresUser,
        password,
      })
      this.connectionKey = key
    }
    return this.pool
  }
}
