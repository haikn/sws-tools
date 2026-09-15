import {
  DeleteItemCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  PutItemCommand,
  ScanCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { getSettings } from './store'
import { isExtensionWebview, requestBackend } from './platformApi'

export type DynamoItem = Record<string, AttributeValue>

export interface DynamoTableInfo {
  name: string
  partitionKey: string
  sortKey?: string
  itemCount: number
}

export interface ScanPage {
  items: DynamoItem[]
  lastEvaluatedKey?: DynamoItem
}

interface JsonSet {
  $set?: unknown[]
  $numberSet?: number[]
}

let cachedClient: DynamoDBClient | null = null
let cachedClientKey = ''

function getClient(): DynamoDBClient {
  const settings = getSettings()
  const endpoint = `${window.location.origin}/dynamodb`
  const key = `${endpoint}|${settings.dynamoRegion}`
  if (!cachedClient || cachedClientKey !== key) {
    cachedClient?.destroy()
    cachedClient = new DynamoDBClient({
      endpoint,
      region: settings.dynamoRegion,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    })
    cachedClientKey = key
  }
  return cachedClient
}

function setsToJson(value: unknown): unknown {
  if (value instanceof Set) {
    const values = Array.from(value)
    return values.every((entry) => typeof entry === 'number')
      ? { $numberSet: values }
      : { $set: values }
  }
  if (Array.isArray(value)) return value.map(setsToJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, setsToJson(entry)]))
  }
  return value
}

function jsonToSets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonToSets)
  if (value && typeof value === 'object') {
    const candidate = value as JsonSet
    if (Object.keys(candidate).length === 1 && Array.isArray(candidate.$set)) {
      return new Set(candidate.$set)
    }
    if (Object.keys(candidate).length === 1 && Array.isArray(candidate.$numberSet)) {
      return new Set(candidate.$numberSet)
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonToSets(entry)]))
  }
  return value
}

export function toDocumentJson(item: DynamoItem): Record<string, unknown> {
  return setsToJson(unmarshall(item)) as Record<string, unknown>
}

export function toAttributeJson(value: unknown): DynamoItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A DynamoDB item must be a JSON object.')
  }
  return marshall(jsonToSets(value) as Record<string, unknown>, { removeUndefinedValues: true })
}

export function extractItemKey(item: DynamoItem, keyNames: string[]): DynamoItem {
  const key: DynamoItem = {}
  for (const name of keyNames) {
    if (!item[name]) throw new Error(`Missing key attribute: ${name}`)
    key[name] = item[name]
  }
  return key
}

export async function listTables(): Promise<string[]> {
  if (isExtensionWebview()) return requestBackend<string[]>('/_dynamodb', { action: 'listTables' })
  const names: string[] = []
  let startName: string | undefined
  do {
    const response = await getClient().send(new ListTablesCommand({ ExclusiveStartTableName: startName }))
    names.push(...(response.TableNames ?? []))
    startName = response.LastEvaluatedTableName
  } while (startName)
  return names.sort((left, right) => left.localeCompare(right))
}

export async function describeTable(tableName: string): Promise<DynamoTableInfo> {
  if (isExtensionWebview()) return requestBackend<DynamoTableInfo>('/_dynamodb', { action: 'describeTable', tableName })
  const response = await getClient().send(new DescribeTableCommand({ TableName: tableName }))
  const table = response.Table
  const partitionKey = table?.KeySchema?.find((key) => key.KeyType === 'HASH')?.AttributeName
  if (!partitionKey) throw new Error(`Table ${tableName} has no partition key.`)
  return {
    name: table.TableName ?? tableName,
    partitionKey,
    sortKey: table.KeySchema?.find((key) => key.KeyType === 'RANGE')?.AttributeName,
    itemCount: table.ItemCount ?? 0,
  }
}

export async function scanTable(tableName: string, startKey?: DynamoItem): Promise<ScanPage> {
  if (isExtensionWebview()) return requestBackend<ScanPage>('/_dynamodb', { action: 'scanTable', tableName, startKey })
  const response = await getClient().send(new ScanCommand({
    TableName: tableName,
    Limit: 10,
    ExclusiveStartKey: startKey,
  }))
  return { items: response.Items ?? [], lastEvaluatedKey: response.LastEvaluatedKey }
}

export async function putItem(tableName: string, item: DynamoItem): Promise<void> {
  if (isExtensionWebview()) {
    await requestBackend('/_dynamodb', { action: 'putItem', tableName, item })
    return
  }
  toDocumentJson(item)
  await getClient().send(new PutItemCommand({ TableName: tableName, Item: item }))
}

export async function deleteItem(tableName: string, key: DynamoItem): Promise<void> {
  if (isExtensionWebview()) {
    await requestBackend('/_dynamodb', { action: 'deleteItem', tableName, key })
    return
  }
  await getClient().send(new DeleteItemCommand({ TableName: tableName, Key: key }))
}

export async function truncateTable(tableName: string, keyNames: string[]): Promise<number> {
  if (isExtensionWebview()) {
    const result = await requestBackend<{ deleted: number }>('/_dynamodb', { action: 'truncateTable', tableName, keyNames })
    return result.deleted
  }
  let startKey: DynamoItem | undefined
  let deleted = 0
  do {
    const page = await scanTable(tableName, startKey)
    for (const item of page.items) {
      await deleteItem(tableName, extractItemKey(item, keyNames))
      deleted++
    }
    startKey = page.lastEvaluatedKey
  } while (startKey)
  return deleted
}