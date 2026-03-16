export const PPT_TEXT_LINE_HEIGHT_FACTOR = 1.67;
export const PPT_TEXT_CHAR_WIDTH_FACTOR = 1.78;
export const PPT_TEXT_SAFE_HEIGHT_PADDING = 0.02;
export const PPT_TEXT_SAFE_SINGLE_LINE_RESERVED_CHARS = 2;
export const PPT_CHARACTERS_PER_INCH = 72;
export const PPT_TEXT_PIXELS_PER_INCH = 96;
export const PPT_TEXT_FULL_WIDTH_EM = 0.75;
export const PPT_TEXT_ASCII_LETTER_EM = 0.67;
export const PPT_TEXT_ASCII_DIGIT_EM = 0.56;
export const PPT_TEXT_BULLET_EM = 0.35;
export const PPT_TEXT_SPACE_EM = 0.28;
export const PPT_TEXT_SAFE_WIDTH_RATIO = 0.96;

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

export function recommendSingleLineChars(width: number, fontSize: number, reservedChars = PPT_TEXT_SAFE_SINGLE_LINE_RESERVED_CHARS): number {
  return Math.max(1, calculateMaxCharsPerLine(width, fontSize) - reservedChars);
}

function estimateCharacterWidthEm(character: string): number {
  if (character === '•') return PPT_TEXT_BULLET_EM;
  if (/\s/u.test(character)) return PPT_TEXT_SPACE_EM;
  if (/[0-9]/u.test(character)) return PPT_TEXT_ASCII_DIGIT_EM;
  if (/[A-Za-z]/u.test(character)) return PPT_TEXT_ASCII_LETTER_EM;
  return PPT_TEXT_FULL_WIDTH_EM;
}

export function estimateTextWidthPx(text: string, fontSize: number): number {
  const totalWidthEm = Array.from(text).reduce((width, character) => width + estimateCharacterWidthEm(character), 0);
  return totalWidthEm * fontSize;
}

export function calculateSafeSingleLineWidthPx(width: number, safeWidthRatio = PPT_TEXT_SAFE_WIDTH_RATIO): number {
  return Math.floor(width * PPT_TEXT_PIXELS_PER_INCH * safeWidthRatio);
}

export function doesTextFitSingleLine(text: string, width: number, fontSize: number, safeWidthRatio = PPT_TEXT_SAFE_WIDTH_RATIO): boolean {
  return estimateTextWidthPx(text, fontSize) <= calculateSafeSingleLineWidthPx(width, safeWidthRatio);
}
