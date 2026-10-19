import { DocumentSuggestions, mergeSuggestions } from './document-suggestions'

describe('mergeSuggestions', () => {
  const ai: DocumentSuggestions = {
    tags: [1],
    suggestion_details: { tags: { 1: 'Configured account' } },
    custom_fields: [{ field: 80, value: '2025-01-01' }],
  }
  const classic: DocumentSuggestions = { tags: [2] }

  it.each([
    [classic, ai],
    [ai, classic],
  ])(
    'preserves provider dates and explanations in either response order',
    (a, b) => {
      const merged = mergeSuggestions(a, b)
      expect(merged.tags).toEqual(expect.arrayContaining([1, 2]))
      expect(merged.custom_fields).toEqual(ai.custom_fields)
      expect(merged.suggestion_details).toEqual(ai.suggestion_details)
    }
  )

  it('keeps distinct alternatives without duplicating identical date proposals', () => {
    const merged = mergeSuggestions(ai, {
      suggestion_details: { tags: { 2: 'Additional account' } },
      custom_fields: [
        { field: 80, value: '2025-01-01' },
        { field: 80, value: '2025-01-02' },
      ],
    })
    expect(merged.custom_fields).toHaveLength(2)
    expect(merged.suggestion_details.tags).toEqual({
      1: 'Configured account',
      2: 'Additional account',
    })
    expect(ai.custom_fields).toHaveLength(1)
    expect(ai.suggestion_details.tags).toEqual({ 1: 'Configured account' })
  })
})
