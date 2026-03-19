export interface ScriptAssert {
  (condition: unknown, message?: string): boolean;
  equal(actual: unknown, expected: unknown, message?: string): boolean;
  notEqual(actual: unknown, expected: unknown, message?: string): boolean;
  lessThanOrEqual(actual: number, expected: number, message?: string): boolean;
  greaterThanOrEqual(actual: number, expected: number, message?: string): boolean;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createScriptAssert(recordWarning: (message: string) => void): ScriptAssert {
  const pushWarning = (message: string) => {
    const trimmed = message.trim();
    recordWarning(trimmed || '断言失败');
  };

  const assert = ((condition: unknown, message = '断言失败') => {
    if (condition) return true;
    pushWarning(message);
    return false;
  }) as ScriptAssert;

  assert.equal = (actual, expected, message) => (
    assert(Object.is(actual, expected), message ?? `断言失败：期望 ${formatValue(expected)}，实际是 ${formatValue(actual)}`)
  );
  assert.notEqual = (actual, expected, message) => (
    assert(!Object.is(actual, expected), message ?? `断言失败：不应为 ${formatValue(expected)}，实际是 ${formatValue(actual)}`)
  );
  assert.lessThanOrEqual = (actual, expected, message) => (
    assert(actual <= expected, message ?? `断言失败：期望不大于 ${formatValue(expected)}，实际是 ${formatValue(actual)}`)
  );
  assert.greaterThanOrEqual = (actual, expected, message) => (
    assert(actual >= expected, message ?? `断言失败：期望不小于 ${formatValue(expected)}，实际是 ${formatValue(actual)}`)
  );

  return assert;
}
