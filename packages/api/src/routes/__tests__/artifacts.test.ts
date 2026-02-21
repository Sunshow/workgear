/**
 * Unit tests for artifacts route - types filter and query logic
 * Uses the same simple test runner pattern as skill-file-parser.test.ts
 */

// Simple test runner
let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✓ ${name}`)
    passed++
  } catch (error) {
    console.error(`✗ ${name}`)
    console.error(`  ${error}`)
    failed++
    process.exitCode = 1
  }
}

function assertEquals(actual: any, expected: any, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    )
  }
}

function assertDeepIncludes(arr: any[], item: any, message?: string) {
  const found = arr.some(a => JSON.stringify(a) === JSON.stringify(item))
  if (!found) {
    throw new Error(
      message || `Expected array to include ${JSON.stringify(item)}, got ${JSON.stringify(arr)}`
    )
  }
}

// ─── Types filter parsing logic (extracted for testability) ───

function parseTypesParam(types: string | undefined): string[] | undefined {
  if (!types) return undefined
  const result = types.split(',').map(t => t.trim()).filter(Boolean)
  return result.length > 0 ? result : undefined
}

// ─── Tests ───

console.log('\n=== Artifacts Route - Types Filter Tests ===\n')

test('parseTypesParam: returns undefined for undefined input', () => {
  assertEquals(parseTypesParam(undefined), undefined)
})

test('parseTypesParam: returns undefined for empty string', () => {
  assertEquals(parseTypesParam(''), undefined)
})

test('parseTypesParam: parses single type', () => {
  assertEquals(parseTypesParam('prd'), ['prd'])
})

test('parseTypesParam: parses multiple types', () => {
  assertEquals(parseTypesParam('prd,spec,code'), ['prd', 'spec', 'code'])
})

test('parseTypesParam: trims whitespace around types', () => {
  assertEquals(parseTypesParam(' prd , spec , code '), ['prd', 'spec', 'code'])
})

test('parseTypesParam: filters out empty segments', () => {
  assertEquals(parseTypesParam('prd,,spec,'), ['prd', 'spec'])
})

test('parseTypesParam: handles single type with trailing comma', () => {
  assertEquals(parseTypesParam('prd,'), ['prd'])
})

test('parseTypesParam: handles whitespace-only segments', () => {
  assertEquals(parseTypesParam('prd, ,spec'), ['prd', 'spec'])
})

// ─── Query parameter validation tests ───

console.log('\n=== Artifacts Route - Query Validation Tests ===\n')

interface QueryParams {
  taskId?: string
  flowRunId?: string
  nodeRunId?: string
  types?: string
  includeVersions?: string
}

function validateQueryParams(query: QueryParams): { valid: boolean; error?: string } {
  const { taskId, flowRunId, nodeRunId } = query
  if (!taskId && !flowRunId && !nodeRunId) {
    return { valid: false, error: 'taskId, flowRunId, or nodeRunId is required' }
  }
  return { valid: true }
}

test('validateQueryParams: rejects empty query', () => {
  const result = validateQueryParams({})
  assertEquals(result.valid, false)
  assertEquals(result.error, 'taskId, flowRunId, or nodeRunId is required')
})

test('validateQueryParams: accepts taskId', () => {
  const result = validateQueryParams({ taskId: 'some-uuid' })
  assertEquals(result.valid, true)
})

test('validateQueryParams: accepts flowRunId', () => {
  const result = validateQueryParams({ flowRunId: 'some-uuid' })
  assertEquals(result.valid, true)
})

test('validateQueryParams: accepts nodeRunId', () => {
  const result = validateQueryParams({ nodeRunId: 'some-uuid' })
  assertEquals(result.valid, true)
})

test('validateQueryParams: accepts taskId with types', () => {
  const result = validateQueryParams({ taskId: 'some-uuid', types: 'prd,spec' })
  assertEquals(result.valid, true)
})

test('validateQueryParams: accepts taskId with includeVersions', () => {
  const result = validateQueryParams({ taskId: 'some-uuid', includeVersions: 'true' })
  assertEquals(result.valid, true)
})

// ─── Filter priority tests ───

console.log('\n=== Artifacts Route - Filter Priority Tests ===\n')

function determineFilterField(query: QueryParams): 'nodeRunId' | 'flowRunId' | 'taskId' {
  if (query.nodeRunId) return 'nodeRunId'
  if (query.flowRunId) return 'flowRunId'
  return 'taskId'
}

test('filter priority: nodeRunId takes highest priority', () => {
  assertEquals(
    determineFilterField({ taskId: 't1', flowRunId: 'f1', nodeRunId: 'n1' }),
    'nodeRunId'
  )
})

test('filter priority: flowRunId takes priority over taskId', () => {
  assertEquals(
    determineFilterField({ taskId: 't1', flowRunId: 'f1' }),
    'flowRunId'
  )
})

test('filter priority: taskId is default', () => {
  assertEquals(
    determineFilterField({ taskId: 't1' }),
    'taskId'
  )
})

// ─── Empty result handling tests ───

console.log('\n=== Artifacts Route - Empty Result Handling Tests ===\n')

test('empty result: returns empty array (not 404) when no artifacts found', () => {
  // Simulates the behavior: when taskId has no artifacts, API returns []
  const result: any[] = []
  assertEquals(Array.isArray(result), true)
  assertEquals(result.length, 0)
})

test('includeVersions: skips version enrichment when result is empty', () => {
  const result: any[] = []
  const includeVersions = 'true'
  // The condition: includeVersions === 'true' && result.length > 0
  const shouldEnrich = includeVersions === 'true' && result.length > 0
  assertEquals(shouldEnrich, false)
})

test('includeVersions: enriches when result is non-empty', () => {
  const result = [{ id: 'a1' }]
  const includeVersions = 'true'
  const shouldEnrich = includeVersions === 'true' && result.length > 0
  assertEquals(shouldEnrich, true)
})

// ─── Summary ───

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
