import {
  DeleteItemCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  PutItemCommand,
  ScanCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb'
import { ExtensionSettingsService } from './extensionSettings.js'

type DynamoItem = Record<string, AttributeValue>
type RequestBody = Record<string, unknown>

function keyItem(value: unknown): DynamoItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DynamoDB key must be an object.')
  return value as DynamoItem
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is required.`)
  return value
}

export class DynamoService {
  private client: DynamoDBClient | null = null
  private clientKey = ''

  constructor(private readonly settings: ExtensionSettingsService) {}

  async execute(body: RequestBody): Promise<unknown> {
    const client = await this.getClient()
    const action = body.action

    if (action === 'listTables') {
      const names: string[] = []
      let startName: string | undefined
      do {
        const result = await client.send(new ListTablesCommand({ ExclusiveStartTableName: startName }))
        names.push(...(result.TableNames ?? []))
        startName = result.LastEvaluatedTableName
      } while (startName)
      return names.sort((left, right) => left.localeCompare(right))
    }

    const tableName = requiredString(body.tableName, 'Table name')
    if (action === 'describeTable') {
      const result = await client.send(new DescribeTableCommand({ TableName: tableName }))
      const table = result.Table
      const partitionKey = table?.KeySchema?.find((key) => key.KeyType === 'HASH')?.AttributeName
      if (!partitionKey) throw new Error(`Table ${tableName} has no partition key.`)
      return {
        name: table.TableName ?? tableName,
        partitionKey,
        sortKey: table.KeySchema?.find((key) => key.KeyType === 'RANGE')?.AttributeName,
        itemCount: table.ItemCount ?? 0,
      }
    }
    if (action === 'scanTable') {
      const result = await client.send(new ScanCommand({
        TableName: tableName,
        Limit: 10,
        ExclusiveStartKey: body.startKey as DynamoItem | undefined,
      }))
      return { items: result.Items ?? [], lastEvaluatedKey: result.LastEvaluatedKey }
    }
    if (action === 'putItem') {
      await client.send(new PutItemCommand({ TableName: tableName, Item: keyItem(body.item) }))
      return { ok: true }
    }
    if (action === 'deleteItem') {
      await client.send(new DeleteItemCommand({ TableName: tableName, Key: keyItem(body.key) }))
      return { ok: true }
    }
    if (action === 'truncateTable') {
      const keyNames = Array.isArray(body.keyNames) ? body.keyNames.map(String) : []
      if (!keyNames.length) throw new Error('At least one key attribute is required to truncate a table.')
      let startKey: DynamoItem | undefined
      let deleted = 0
      do {
        const page = await client.send(new ScanCommand({ TableName: tableName, Limit: 10, ExclusiveStartKey: startKey }))
        for (const item of page.Items ?? []) {
          const key: DynamoItem = {}
          for (const name of keyNames) {
            if (!item[name]) throw new Error(`Missing key attribute: ${name}`)
            key[name] = item[name]
          }
          await client.send(new DeleteItemCommand({ TableName: tableName, Key: key }))
          deleted++
        }
        startKey = page.LastEvaluatedKey
      } while (startKey)
      return { deleted }
    }
    throw new Error('Unknown DynamoDB action')
  }

  dispose(): void {
    this.client?.destroy()
    this.client = null
  }

  private async getClient(): Promise<DynamoDBClient> {
    const configuration = await this.settings.read()
    const key = `${configuration.dynamodbEndpoint}|${configuration.dynamodbRegion}`
    if (!this.client || this.clientKey !== key) {
      this.client?.destroy()
      this.client = new DynamoDBClient({
        endpoint: configuration.dynamodbEndpoint,
        region: configuration.dynamodbRegion,
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      })
      this.clientKey = key
    }
    return this.client
  }
}
