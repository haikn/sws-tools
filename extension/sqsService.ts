import {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  ListQueuesCommand,
} from '@aws-sdk/client-sqs'
import { ExtensionSettingsService } from './extensionSettings.js'

type RequestBody = Record<string, unknown>

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is required.`)
  return value
}

export class SqsService {
  private client: SQSClient | null = null
  private clientKey = ''

  constructor(private readonly settings: ExtensionSettingsService) {}

  async execute(body: RequestBody): Promise<unknown> {
    const client = await this.getClient()
    switch (body.action) {
      case 'listQueues': {
        const result = await client.send(new ListQueuesCommand({ MaxResults: 1000 }))
        const urls = result.QueueUrls ?? []
        const queues = await Promise.all(urls.map(async (url) => {
          const attributes = await client.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed'] }))
          const name = url.split('/').at(-1) ?? url
          return {
            name,
            url,
            visible: Number(attributes.Attributes?.ApproximateNumberOfMessages ?? 0),
            inFlight: Number(attributes.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
            delayed: Number(attributes.Attributes?.ApproximateNumberOfMessagesDelayed ?? 0),
            isFifo: name.endsWith('.fifo'),
            isDlq: /dlq|dead/i.test(name),
          }
        }))
        return queues.sort((left, right) => left.name.localeCompare(right.name))
      }
      case 'queueDetails': {
        const queueUrl = requiredString(body.queueUrl, 'Queue URL')
        const [attributes, messages] = await Promise.all([
          client.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['All'] })),
          client.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, VisibilityTimeout: 0, AttributeNames: ['All'], MessageAttributeNames: ['All'] })),
        ])
        return {
          attributes: attributes.Attributes ?? {},
          messages: (messages.Messages ?? []).map((message) => ({
            messageId: message.MessageId ?? '',
            receiptHandle: message.ReceiptHandle ?? '',
            body: message.Body ?? '',
            sentAt: message.Attributes?.SentTimestamp ? new Date(Number(message.Attributes.SentTimestamp)).toISOString() : null,
            attributes: message.Attributes ?? {},
            messageAttributes: Object.fromEntries(Object.entries(message.MessageAttributes ?? {}).map(([name, value]) => [name, value.StringValue ?? ''])),
          })),
        }
      }
      case 'createQueue': {
        const name = requiredString(body.name, 'Queue name')
        const fifo = body.fifo === true
        const queueName = fifo && !name.endsWith('.fifo') ? `${name}.fifo` : name
        const attributes: Record<string, string> = {
          VisibilityTimeout: String(body.visibilityTimeout ?? 30),
          MessageRetentionPeriod: String(body.retentionPeriod ?? 345600),
          MaximumMessageSize: String(body.maxMessageSize ?? 262144),
          DelaySeconds: String(body.delaySeconds ?? 0),
          ReceiveMessageWaitTimeSeconds: String(body.receiveWaitTime ?? 0),
        }
        if (fifo) attributes.FifoQueue = 'true'
        const result = await client.send(new CreateQueueCommand({ QueueName: queueName, Attributes: attributes }))
        return result.QueueUrl ?? ''
      }
      case 'sendMessage': {
        const queueUrl = requiredString(body.queueUrl, 'Queue URL')
        const input: SendMessageCommand['input'] = { QueueUrl: queueUrl, MessageBody: requiredString(body.body, 'Message body') }
        if (queueUrl.endsWith('.fifo')) {
          input.MessageGroupId = 'default'
          input.MessageDeduplicationId = crypto.randomUUID()
        }
        const result = await client.send(new SendMessageCommand(input))
        return result.MessageId ?? ''
      }
      case 'purgeQueue': await client.send(new PurgeQueueCommand({ QueueUrl: requiredString(body.queueUrl, 'Queue URL') })); return { ok: true }
      case 'deleteQueue': await client.send(new DeleteQueueCommand({ QueueUrl: requiredString(body.queueUrl, 'Queue URL') })); return { ok: true }
      case 'deleteMessage': await client.send(new DeleteMessageCommand({ QueueUrl: requiredString(body.queueUrl, 'Queue URL'), ReceiptHandle: requiredString(body.receiptHandle, 'Receipt handle') })); return { ok: true }
      default: throw new Error('Unknown SQS action')
    }
  }

  dispose(): void {
    this.client?.destroy()
    this.client = null
  }

  private async getClient(): Promise<SQSClient> {
    const configuration = await this.settings.read()
    const key = `${configuration.sqsEndpoint}|${configuration.sqsRegion}`
    if (!this.client || this.clientKey !== key) {
      this.client?.destroy()
      this.client = new SQSClient({ endpoint: configuration.sqsEndpoint, region: configuration.sqsRegion, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } })
      this.clientKey = key
    }
    return this.client
  }
}
