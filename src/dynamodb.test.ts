import { describe, expect, it } from 'vitest'
import { extractItemKey, toAttributeJson, toDocumentJson } from './dynamodb'

describe('DynamoDB item conversion', () => {
  it('round-trips normal JSON through AttributeValue JSON', () => {
    const document = {
      id: 'order-1',
      count: 3,
      active: true,
      optional: null,
      tags: ['new', 'priority'],
      details: { owner: 'sam' },
    }

    expect(toDocumentJson(toAttributeJson(document))).toEqual(document)
  })

  it('preserves DynamoDB string and number sets', () => {
    const raw = {
      labels: { SS: ['one', 'two'] },
      scores: { NS: ['1', '2.5'] },
    }

    expect(toAttributeJson(toDocumentJson(raw))).toEqual(raw)
  })
})

describe('extractItemKey', () => {
  it('extracts a partition and sort key without other attributes', () => {
    const item = {
      accountId: { S: 'account-1' },
      createdAt: { N: '42' },
      message: { S: 'not part of the key' },
    }

    expect(extractItemKey(item, ['accountId', 'createdAt'])).toEqual({
      accountId: { S: 'account-1' },
      createdAt: { N: '42' },
    })
  })

  it('rejects an item with a missing key attribute', () => {
    expect(() => extractItemKey({ accountId: { S: 'account-1' } }, ['accountId', 'createdAt']))
      .toThrow('Missing key attribute: createdAt')
  })
})