import * as vscode from 'vscode'

export interface ExtensionSettings {
  sqsEndpoint: string
  sqsRegion: string
  dynamodbEndpoint: string
  dynamodbRegion: string
  dynamodbRefreshSeconds: number
  dynamodbQuickDelete: boolean
  postgresHost: string
  postgresPort: number
  postgresDatabase: string
  postgresUser: string
  postgresRefreshSeconds: number
  postgresQuickDelete: boolean
  postgresPasswordConfigured: boolean
}

const POSTGRES_PASSWORD_KEY = 'swsMonitor.postgres.password'

export class ExtensionSettingsService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async read(): Promise<ExtensionSettings> {
    const configuration = vscode.workspace.getConfiguration('swsMonitor')
    return {
      sqsEndpoint: configuration.get<string>('sqs.endpoint', 'http://localhost:9324'),
      sqsRegion: configuration.get<string>('sqs.region', 'eu-west-1'),
      dynamodbEndpoint: configuration.get<string>('dynamodb.endpoint', 'http://localhost:9324'),
      dynamodbRegion: configuration.get<string>('dynamodb.region', 'eu-west-1'),
      dynamodbRefreshSeconds: configuration.get<number>('dynamodb.refreshSeconds', 0),
      dynamodbQuickDelete: configuration.get<boolean>('dynamodb.quickDelete', false),
      postgresHost: configuration.get<string>('postgres.host', 'localhost'),
      postgresPort: configuration.get<number>('postgres.port', 5432),
      postgresDatabase: configuration.get<string>('postgres.database', 'ecu-update-db'),
      postgresUser: configuration.get<string>('postgres.user', 'postgres'),
      postgresRefreshSeconds: configuration.get<number>('postgres.refreshSeconds', 0),
      postgresQuickDelete: configuration.get<boolean>('postgres.quickDelete', false),
      postgresPasswordConfigured: Boolean(await this.context.secrets.get(POSTGRES_PASSWORD_KEY)),
    }
  }

  async setPostgresPassword(password: string): Promise<void> {
    await this.context.secrets.store(POSTGRES_PASSWORD_KEY, password)
  }

  async getPostgresPassword(): Promise<string> {
    return (await this.context.secrets.get(POSTGRES_PASSWORD_KEY)) ?? ''
  }

  async clearPostgresPassword(): Promise<void> {
    await this.context.secrets.delete(POSTGRES_PASSWORD_KEY)
  }
}
