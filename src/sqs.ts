export interface QueueInfo {
  name: string
  url: string
  visible: number
  inFlight: number
  delayed: number
  isFifo: boolean
  isDlq: boolean
}

import { getSettings } from './store'
import { isExtensionWebview, requestBackend } from './platformApi'

const STORAGE_REGION = 'sqs-monitor-region'

let currentRegion = localStorage.getItem(STORAGE_REGION) ?? getSettings().defaultRegion

export function setRegion(region: string) {
  currentRegion = region
  localStorage.setItem(STORAGE_REGION, region)
}

export function getRegion() {
  return currentRegion
}

function authHeader() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `AWS4-HMAC-SHA256 Credential=test/${date}/${currentRegion}/sqs/aws4_request, SignedHeaders=host, Signature=fake`
}

async function sqsPost(params: Record<string, string>): Promise<Document> {
  const body = new URLSearchParams({ Version: '2012-11-05', ...params })
  const res = await fetch('/localstack/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': authHeader(),
    },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`SQS ${res.status}: ${res.statusText}`)
  const text = await res.text()
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  const code = doc.querySelector('ErrorResponse Error Code')?.textContent
  const message = doc.querySelector('ErrorResponse Error Message')?.textContent
  if (code || message) {
    throw new Error(`SQS error${code ? ` (${code})` : ''}: ${message ?? 'Unknown error'}`)
  }
  return doc
}

function getAllText(doc: Document, tag: string): string[] {
  return Array.from(doc.querySelectorAll(tag)).map((el) => el.textContent ?? '')
}

function parseAttributes(doc: Document): Record<string, string> {
  const result: Record<string, string> = {}
  doc.querySelectorAll('Attribute').forEach((el) => {
    const name = el.querySelector('Name')?.textContent ?? ''
    const value = el.querySelector('Value')?.textContent ?? '0'
    if (name) result[name] = value
  })
  return result
}

export interface QueueMessage {
  messageId: string
  receiptHandle: string
  body: string
  sentAt: Date | null
  attributes: Record<string, string>
  messageAttributes: Record<string, string>
}

export interface QueueDetails {
  attributes: Record<string, string>
  messages: QueueMessage[]
}

export async function fetchQueueDetails(queueUrl: string): Promise<QueueDetails> {
  if (isExtensionWebview()) return requestBackend<QueueDetails>('/_sqs', { action: 'queueDetails', queueUrl })
  const [attrsDoc, msgsDoc] = await Promise.all([
    sqsPost({ Action: 'GetQueueAttributes', QueueUrl: queueUrl, 'AttributeName.1': 'All' }),
    sqsPost({
      Action: 'ReceiveMessage',
      QueueUrl: queueUrl,
      MaxNumberOfMessages: '10',
      VisibilityTimeout: '0',
      'AttributeName.1': 'All',
      'MessageAttributeName.1': 'All',
    }),
  ])

  const attributes = parseAttributes(attrsDoc)

  const messages: QueueMessage[] = Array.from(msgsDoc.querySelectorAll('Message')).map((el) => {
    const msgAttrs: Record<string, string> = {}
    el.querySelectorAll('Attribute').forEach((a) => {
      const n = a.querySelector('Name')?.textContent ?? ''
      const v = a.querySelector('Value')?.textContent ?? ''
      if (n) msgAttrs[n] = v
    })
    const msgCustomAttrs: Record<string, string> = {}
    el.querySelectorAll('MessageAttribute').forEach((a) => {
      const n = a.querySelector('Name')?.textContent ?? ''
      const v = a.querySelector('StringValue,BinaryValue')?.textContent ?? ''
      if (n) msgCustomAttrs[n] = v
    })
    const sentTs = msgAttrs['SentTimestamp']
    return {
      messageId: el.querySelector('MessageId')?.textContent ?? '',
      receiptHandle: el.querySelector('ReceiptHandle')?.textContent ?? '',
      body: el.querySelector('Body')?.textContent ?? '',
      sentAt: sentTs ? new Date(parseInt(sentTs)) : null,
      attributes: msgAttrs,
      messageAttributes: msgCustomAttrs,
    }
  })

  return { attributes, messages }
}

export interface CreateQueueParams {
  name: string
  fifo: boolean
  visibilityTimeout: number
  retentionPeriod: number
  maxMessageSize: number
  delaySeconds: number
  receiveWaitTime: number
}

export async function createQueue(params: CreateQueueParams): Promise<string> {
  if (isExtensionWebview()) return requestBackend<string>('/_sqs', { action: 'createQueue', ...params })
  const queueName = params.fifo && !params.name.endsWith('.fifo')
    ? `${params.name}.fifo`
    : params.name

  const attrs: Record<string, string> = {
    'Attribute.1.Name': 'VisibilityTimeout',      'Attribute.1.Value': String(params.visibilityTimeout),
    'Attribute.2.Name': 'MessageRetentionPeriod', 'Attribute.2.Value': String(params.retentionPeriod),
    'Attribute.3.Name': 'MaximumMessageSize',     'Attribute.3.Value': String(params.maxMessageSize),
    'Attribute.4.Name': 'DelaySeconds',           'Attribute.4.Value': String(params.delaySeconds),
    'Attribute.5.Name': 'ReceiveMessageWaitTimeSeconds', 'Attribute.5.Value': String(params.receiveWaitTime),
  }
  if (params.fifo) {
    attrs['Attribute.6.Name'] = 'FifoQueue'
    attrs['Attribute.6.Value'] = 'true'
  }

  const doc = await sqsPost({ Action: 'CreateQueue', QueueName: queueName, ...attrs })
  return doc.querySelector('QueueUrl')?.textContent ?? ''
}

export async function sendMessage(queueUrl: string, body: string): Promise<string> {
  if (isExtensionWebview()) return requestBackend<string>('/_sqs', { action: 'sendMessage', queueUrl, body })
  const params: Record<string, string> = {
    Action: 'SendMessage',
    QueueUrl: queueUrl,
    MessageBody: body,
  }

  if (queueUrl.endsWith('.fifo')) {
    params.MessageGroupId = 'default'
    // Works regardless of the queue's content-based deduplication setting.
    params.MessageDeduplicationId = crypto.randomUUID()
  }

  const doc = await sqsPost(params)
  const messageId = doc.querySelector('MessageId')?.textContent ?? ''
  if (!messageId) throw new Error('SQS returned no MessageId')
  return messageId
}

export async function purgeQueue(queueUrl: string): Promise<void> {
  if (isExtensionWebview()) { await requestBackend('/_sqs', { action: 'purgeQueue', queueUrl }); return }
  await sqsPost({ Action: 'PurgeQueue', QueueUrl: queueUrl })
}

export async function deleteQueue(queueUrl: string): Promise<void> {
  if (isExtensionWebview()) { await requestBackend('/_sqs', { action: 'deleteQueue', queueUrl }); return }
  await sqsPost({ Action: 'DeleteQueue', QueueUrl: queueUrl })
}

export async function deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
  if (isExtensionWebview()) { await requestBackend('/_sqs', { action: 'deleteMessage', queueUrl, receiptHandle }); return }
  await sqsPost({ Action: 'DeleteMessage', QueueUrl: queueUrl, ReceiptHandle: receiptHandle })
}

const RECREATE_ATTRS = [
  'VisibilityTimeout',
  'MaximumMessageSize',
  'MessageRetentionPeriod',
  'DelaySeconds',
  'ReceiveMessageWaitTimeSeconds',
]

export async function recreateQueue(
  name: string,
  currentUrl: string,
  attributes: Record<string, string>
): Promise<void> {
  await sqsPost({ Action: 'DeleteQueue', QueueUrl: currentUrl })

  const params: Record<string, string> = { Action: 'CreateQueue', QueueName: name }
  let i = 1
  for (const key of RECREATE_ATTRS) {
    if (attributes[key] !== undefined) {
      params[`Attribute.${i}.Name`] = key
      params[`Attribute.${i}.Value`] = attributes[key]
      i++
    }
  }
  if (name.endsWith('.fifo')) {
    params[`Attribute.${i}.Name`] = 'FifoQueue'
    params[`Attribute.${i}.Value`] = 'true'
  }

  await sqsPost(params)
}

export async function fetchQueues(): Promise<QueueInfo[]> {
  if (isExtensionWebview()) return requestBackend<QueueInfo[]>('/_sqs', { action: 'listQueues' })
  const listDoc = await sqsPost({ Action: 'ListQueues', MaxResults: '1000' })
  const urls = getAllText(listDoc, 'QueueUrl').filter(Boolean)

  const results = await Promise.all(
    urls.map(async (url) => {
      const attrsDoc = await sqsPost({
        Action: 'GetQueueAttributes',
        QueueUrl: url,
        'AttributeName.1': 'ApproximateNumberOfMessages',
        'AttributeName.2': 'ApproximateNumberOfMessagesNotVisible',
        'AttributeName.3': 'ApproximateNumberOfMessagesDelayed',
      })
      const a = parseAttributes(attrsDoc)
      const name = url.split('/').at(-1) ?? url
      return {
        name,
        url,
        visible: parseInt(a['ApproximateNumberOfMessages'] ?? '0'),
        inFlight: parseInt(a['ApproximateNumberOfMessagesNotVisible'] ?? '0'),
        delayed: parseInt(a['ApproximateNumberOfMessagesDelayed'] ?? '0'),
        isFifo: name.endsWith('.fifo'),
        isDlq: /dlq|dead/i.test(name),
      } satisfies QueueInfo
    })
  )

  return results.sort((a, b) => a.name.localeCompare(b.name))
}
