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

  assert.equal = (actual, expected, message = `断言失败：期望 ${formatValue(actual)} === ${formatValue(expected)}`) => (
    assert(Object.is(actual, expected), message)
  );
  assert.notEqual = (actual, expected, message = `断言失败：期望 ${formatValue(actual)} !== ${formatValue(expected)}`) => (
    assert(!Object.is(actual, expected), message)
  );
  assert.lessThanOrEqual = (actual, expected, message = `断言失败：期望 ${formatValue(actual)} <= ${formatValue(expected)}`) => (
    assert(actual <= expected, message)
  );
  assert.greaterThanOrEqual = (actual, expected, message = `断言失败：期望 ${formatValue(actual)} >= ${formatValue(expected)}`) => (
    assert(actual >= expected, message)
  );

  return assert;
}
