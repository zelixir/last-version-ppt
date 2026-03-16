export const PPT_TEXT_LINE_HEIGHT_FACTOR = 1.67;
export const PPT_TEXT_CHAR_WIDTH_FACTOR = 2.3;
export const PPT_TEXT_SAFE_HEIGHT_PADDING = 0.02;
export const PPT_CHARACTERS_PER_INCH = 72;

function roundUpToHundredth(value: number): number {
  return Math.ceil(value * 100) / 100;
}

export function calculateTextBoxHeight(fontSize: number, lines = 1): number {
  return roundUpToHundredth((fontSize * PPT_TEXT_LINE_HEIGHT_FACTOR * lines) / 100);
}

export function calculateSafeTextBoxHeight(fontSize: number, lines = 1, padding = PPT_TEXT_SAFE_HEIGHT_PADDING): number {
  return roundUpToHundredth(((fontSize * PPT_TEXT_LINE_HEIGHT_FACTOR * lines) / 100) + padding);
}

export function calculateMaxCharsPerLine(width: number, fontSize: number, charWidthAdjustment = 0): number {
  const effectiveWidth = Math.floor(width * PPT_CHARACTERS_PER_INCH);
  const effectiveCharFactor = PPT_TEXT_CHAR_WIDTH_FACTOR + charWidthAdjustment;
  return Math.max(1, Math.floor((effectiveWidth * effectiveCharFactor) / fontSize));
}

export function recommendSingleLineChars(width: number, fontSize: number, reservedChars = 2): number {
  return Math.max(1, calculateMaxCharsPerLine(width, fontSize) - reservedChars);
}
