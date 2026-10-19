export interface DocumentSuggestions {
  suggestion_details?: Record<string, Record<number, string>>
  title?: string

  tags?: number[]
  suggested_tags?: string[]

  correspondents?: number[]
  suggested_correspondents?: string[]

  document_types?: number[]
  suggested_document_types?: string[]

  storage_paths?: number[]
  suggested_storage_paths?: string[]

  dates?: string[] // ISO-formatted date string e.g. 2022-11-03
  custom_fields?: { field: number; value: string }[] // Existing date fields only
}

const union = <T>(a: T[] = [], b: T[] = []): T[] => [...new Set([...a, ...b])]

export function mergeSuggestions(
  a: DocumentSuggestions,
  b: DocumentSuggestions
): DocumentSuggestions {
  if (!a) return b
  const suggestionDetails = { ...a.suggestion_details }
  for (const [kind, details] of Object.entries(b.suggestion_details ?? {})) {
    suggestionDetails[kind] = { ...suggestionDetails[kind], ...details }
  }
  return {
    title: a.title || b.title,
    tags: union(a.tags, b.tags),
    suggested_tags: union(a.suggested_tags, b.suggested_tags),
    correspondents: union(a.correspondents, b.correspondents),
    suggested_correspondents: union(
      a.suggested_correspondents,
      b.suggested_correspondents
    ),
    document_types: union(a.document_types, b.document_types),
    suggested_document_types: union(
      a.suggested_document_types,
      b.suggested_document_types
    ),
    storage_paths: union(a.storage_paths, b.storage_paths),
    suggested_storage_paths: union(
      a.suggested_storage_paths,
      b.suggested_storage_paths
    ),
    dates: union(a.dates, b.dates),
    suggestion_details: suggestionDetails,
    custom_fields: [
      ...(a.custom_fields ?? []),
      ...(b.custom_fields ?? []),
    ].filter(
      (item, index, items) =>
        items.findIndex(
          (other) => other.field === item.field && other.value === item.value
        ) === index
    ),
  }
}
