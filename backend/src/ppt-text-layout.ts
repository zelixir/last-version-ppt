export const PPT_TEXT_LINE_HEIGHT_FACTOR = 1.67;
// 1.28 = 96px/in × 0.96 safe width ratio ÷ 72pt/in, matching the canvas check
// for full-width Chinese characters at roughly 1.00 × fontSize.
export const PPT_TEXT_CHAR_WIDTH_FACTOR = 1.28;
export const PPT_TEXT_SAFE_HEIGHT_PADDING = 0.02;
export const PPT_TEXT_SAFE_SINGLE_LINE_RESERVED_CHARS = 0;
export const PPT_CHARACTERS_PER_INCH = 72;
export const PPT_TEXT_PIXELS_PER_INCH = 96;
export const PPT_POINT_TO_PIXEL_RATIO = PPT_TEXT_PIXELS_PER_INCH / PPT_CHARACTERS_PER_INCH;
export const PPT_TEXT_FULL_WIDTH_EM = 1;
export const PPT_TEXT_ASCII_LETTER_EM = 0.67;
export const PPT_TEXT_ASCII_DIGIT_EM = 0.56;
export const PPT_TEXT_BULLET_EM = 0.35;
export const PPT_TEXT_SPACE_EM = 0.28;
export const PPT_TEXT_SAFE_WIDTH_RATIO = 0.96;

export interface MeasureTextOptions {
  fontSize: number;
  fontFace: string;
  width?: number;
  padding?: number;
}

export interface MeasureTextResult {
  width: number;
  widthInches: number;
  height: number;
  safeHeight: number;
  lineHeight: number;
  lines: number;
}

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

/**
 * Estimate a character's width in em for the preview font stack used by the
 * project's layout checks. Chinese characters and full-width punctuation are
 * treated as 1em, while ASCII letters, digits, bullets, and spaces are
 * narrower. These values are only for fast layout estimation; final checks
 * should still use canvas.measureText() with the real font stack.
 */
function estimateCharacterWidthEm(character: string): number {
  if (character === '•') return PPT_TEXT_BULLET_EM;
  if (/\s/u.test(character)) return PPT_TEXT_SPACE_EM;
  if (/[0-9]/u.test(character)) return PPT_TEXT_ASCII_DIGIT_EM;
  if (/[A-Za-z]/u.test(character)) return PPT_TEXT_ASCII_LETTER_EM;
  return PPT_TEXT_FULL_WIDTH_EM;
}

export function estimateTextWidthPx(text: string, fontSize: number): number {
  const totalWidthEm = Array.from(text).reduce((width, character) => width + estimateCharacterWidthEm(character), 0);
  return totalWidthEm * fontSize * PPT_POINT_TO_PIXEL_RATIO;
}

function splitMeasuredLines(text: string, fontSize: number, maxWidthPx?: number): Array<{ text: string; width: number }> {
  const paragraphs = text.split(/\r?\n/u);
  return paragraphs.flatMap(paragraph => {
    if (!paragraph) return [{ text: '', width: 0 }];

    if (!Number.isFinite(maxWidthPx) || !maxWidthPx || maxWidthPx <= 0) {
      return [{ text: paragraph, width: estimateTextWidthPx(paragraph, fontSize) }];
    }

    const lines: Array<{ text: string; width: number }> = [];
    let currentText = '';
    let currentWidth = 0;

    for (const character of Array.from(paragraph)) {
      const characterWidth = estimateCharacterWidthEm(character) * fontSize * PPT_POINT_TO_PIXEL_RATIO;
      if (currentText && currentWidth + characterWidth > maxWidthPx) {
        lines.push({ text: currentText, width: currentWidth });
        currentText = character;
        currentWidth = characterWidth;
        continue;
      }

      currentText += character;
      currentWidth += characterWidth;
    }

    lines.push({ text: currentText, width: currentWidth });
    return lines;
  });
}

export function calculateSafeSingleLineWidthPx(width: number, safeWidthRatio = PPT_TEXT_SAFE_WIDTH_RATIO): number {
  return Math.floor(width * PPT_TEXT_PIXELS_PER_INCH * safeWidthRatio);
}

export function doesTextFitSingleLine(text: string, width: number, fontSize: number, safeWidthRatio = PPT_TEXT_SAFE_WIDTH_RATIO): boolean {
  return estimateTextWidthPx(text, fontSize) <= calculateSafeSingleLineWidthPx(width, safeWidthRatio);
}

export function measureText(text: string, { fontSize, width, padding = PPT_TEXT_SAFE_HEIGHT_PADDING }: MeasureTextOptions): MeasureTextResult {
  const lines = splitMeasuredLines(text, fontSize, width ? calculateSafeSingleLineWidthPx(width) : undefined);
  const maxWidthPx = lines.reduce((max, line) => Math.max(max, line.width), 0);
  const lineCount = Math.max(1, lines.length);
  return {
    width: maxWidthPx,
    widthInches: roundUpToHundredth(maxWidthPx / PPT_TEXT_PIXELS_PER_INCH),
    height: calculateTextBoxHeight(fontSize, lineCount),
    safeHeight: calculateSafeTextBoxHeight(fontSize, lineCount, padding),
    lineHeight: calculateTextBoxHeight(fontSize),
    lines: lineCount,
  };
}
