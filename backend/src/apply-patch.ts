import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

export const PATCH_PREFIX = '*** Begin Patch\n';
export const PATCH_SUFFIX = '\n*** End Patch';
export const ADD_FILE_PREFIX = '*** Add File: ';
export const DELETE_FILE_PREFIX = '*** Delete File: ';
export const UPDATE_FILE_PREFIX = '*** Update File: ';
export const MOVE_FILE_TO_PREFIX = '*** Move to: ';
export const END_OF_FILE_PREFIX = '*** End of File';
export const HUNK_ADD_LINE_PREFIX = '+';
export const HUNK_DELETE_LINE_PREFIX = '-';
const CHUNK_DELIMITER = '@@';
const EDIT_DISTANCE_ALLOWANCE_PER_LINE = 0.34;
const AVOID_EXPLICIT_TABS_REGEX = /\.(tex|latex|sty|cls|bib|bst|ins)$/i;

const PUNCT_EQUIV: Record<string, string> = {
  '-': '-',
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2212': '-',
  '\u0022': '"',
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u00AB': '"',
  '\u00BB': '"',
  '\u0027': "'",
  '\u2018': "'",
  '\u2019': "'",
  '\u201B': "'",
  '\u00A0': ' ',
  '\u202F': ' ',
};

const APPLY_PATCH_FAILURE_DIR = path.resolve(process.cwd(), 'apply-patch-fail-case');

export const APPLY_PATCH_TOOL_DESCRIPTION = [
  'Use the `apply-patch` tool to edit files.',
  'Your patch language is a stripped-down, file-oriented diff format designed to be easy to parse and safe to apply. You can think of it as a high-level envelope:',
  '',
  '*** Begin Patch',
  '[ one or more file sections ]',
  '*** End Patch',
  '',
  'Within that envelope, you get a sequence of file operations.',
  'You MUST include a header to specify the action you are taking.',
  'Each operation starts with one of three headers:',
  '',
  '*** Add File: <path> - create a new file. Every following line is a + line (the initial contents).',
  '*** Delete File: <path> - remove an existing file. Nothing follows.',
  '*** Update File: <path> - patch an existing file in place (optionally with a rename).',
  '',
  'May be immediately followed by *** Move to: <new path> if you want to rename the file.',
  'Then one or more “hunks”, each introduced by @@ (optionally followed by a hunk header).',
  'Within a hunk each line starts with:',
  '',
  'For instructions on [context_before] and [context_after]:',
  '- By default, show 3 lines of code immediately above and 3 lines immediately below each change. If a change is within 3 lines of a previous change, do NOT duplicate the first change\'s [context_after] lines in the second change\'s [context_before] lines.',
  '- If 3 lines of context is insufficient to uniquely identify the snippet of code within the file, use the @@ operator to indicate the class or function to which the snippet belongs. For instance, we might have:',
  '@@ class BaseClass',
  '[3 lines of pre-context]',
  '- [old_code]',
  '+ [new_code]',
  '[3 lines of post-context]',
  '',
  '- If a code block is repeated so many times in a class or function such that even a single `@@` statement and 3 lines of context cannot uniquely identify the snippet of code, you can use multiple `@@` statements to jump to the right context. For instance:',
  '',
  '@@ class BaseClass',
  '@@ \t def method():',
  '[3 lines of pre-context]',
  '- [old_code]',
  '+ [new_code]',
  '[3 lines of post-context]',
  '',
  'The full grammar definition is below:',
  'Patch := Begin { FileOp } End',
  'Begin := "*** Begin Patch" NEWLINE',
  'End := "*** End Patch" NEWLINE',
  'FileOp := AddFile | DeleteFile | UpdateFile',
  'AddFile := "*** Add File: " path NEWLINE { "+" line NEWLINE }',
  'DeleteFile := "*** Delete File: " path NEWLINE',
  'UpdateFile := "*** Update File: " path NEWLINE [ MoveTo ] { Hunk }',
  'MoveTo := "*** Move to: " newPath NEWLINE',
  'Hunk := "@@" [ header ] NEWLINE { HunkLine } [ "*** End of File" NEWLINE ]',
  'HunkLine := (" " | "-" | "+") text NEWLINE',
  '',
  'A full patch can combine several operations:',
  '',
  '*** Begin Patch',
  '*** Add File: /hello.txt',
  '+Hello world',
  '*** Update File: /src/app.py',
  '*** Move to: /src/main.py',
  '@@ def greet():',
  '-print("Hi")',
  '+print("Hello, world!")',
  '*** Delete File: /obsolete.txt',
  '*** End Patch',
  '',
  'It is important to remember:',
  '',
  '- You must include a header with your intended action (Add/Delete/Update)',
  '- You must prefix new lines with `+` even when creating a new file',
  '- Put the full patch text into the `input` field',
  '- File references should stay inside the current project root',
  '- Paths starting with `/` are treated as paths relative to the current project root, for example `/index.js` means the project file `index.js`',
].join('\n');

export const APPLY_PATCH_AGENT_INSTRUCTIONS = [
  'To edit files in the current project, use the `apply-patch` tool.',
  'Always send the full patch in the `input` field. Do not send JSON fragments for individual hunks.',
  'When you are changing an existing file, prefer `apply-patch` over `create-file`.',
  'Use `create-file` only when creating a brand-new file or when the user explicitly needs a full-file overwrite.',
  'Prefer `apply-patch` over ad-hoc search/replace because it is safer and supports add / update / delete / move in one tool call.',
  'When you write file paths, prefer project-relative paths such as `/index.js` or `/docs/outline.md`; a leading `/` still means “inside the current project”.',
  'Example tool call payload:',
  '{"input":"*** Begin Patch\\n*** Update File: /index.js\\n@@ function example() {\\n-  return 1;\\n+  return 2;\\n*** End Patch"}',
].join('\n');

export type ApplyPatchCreateFileOp = {
  type: 'create';
  path: string;
  content: string;
};

export type ApplyPatchDeleteFileOp = {
  type: 'delete';
  path: string;
};

export type ApplyPatchUpdateFileOp = {
  type: 'update';
  path: string;
  update: string;
  added: number;
  deleted: number;
};

export type ApplyPatchOp = ApplyPatchCreateFileOp | ApplyPatchDeleteFileOp | ApplyPatchUpdateFileOp;

export const ActionType = {
  ADD: 'add',
  DELETE: 'delete',
  UPDATE: 'update',
} as const;

export type ActionType = (typeof ActionType)[keyof typeof ActionType];

export interface Chunk {
  origIndex: number;
  delLines: string[];
  insLines: string[];
}

export interface PatchAction {
  type: ActionType;
  newFile?: string;
  chunks: Chunk[];
  movePath?: string;
}

export interface Patch {
  actions: Record<string, PatchAction>;
}

export interface FileChange {
  type: ActionType;
  oldContent?: string;
  newContent?: string;
  movePath?: string;
}

export interface Commit {
  changes: Record<string, FileChange>;
}

export interface AppliedPatchSummary {
  changedFiles: string[];
  createdFiles: string[];
  deletedFiles: string[];
  updatedFiles: string[];
  movedFiles: Array<{ from: string; to: string }>;
  fuzz: number;
}

export class DiffError extends Error {}

export function recordApplyPatchFailureCase(payload: {
  projectId: string;
  input?: string;
  sourceContent: string;
  fileName?: string;
  search?: string;
  replace?: string;
  replaceAll?: boolean;
  error: unknown;
}): void {
  try {
    mkdirSync(APPLY_PATCH_FAILURE_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeProjectId = payload.projectId.replace(/[^\w.-]/g, '_') || 'unknown-project';
    const maxLength = 200_000;
    const trimmedInput = typeof payload.input === 'string' && payload.input.length > maxLength
      ? payload.input.slice(0, maxLength)
      : payload.input;
    const failCaseDir = path.join(
      APPLY_PATCH_FAILURE_DIR,
      `${timestamp}-${Math.random().toString(36).slice(2, 8)}-${safeProjectId}`,
    );
    mkdirSync(failCaseDir, { recursive: true });
    const serializedError = payload.error instanceof Error
      ? { name: payload.error.name, message: payload.error.message, stack: payload.error.stack }
      : { message: String(payload.error) };
    const savedAt = new Date().toISOString();
    const legacyPatchBody = [
      payload.fileName ? `fileName: ${payload.fileName}` : undefined,
      typeof payload.search === 'string' ? `search:\n${payload.search}` : undefined,
      typeof payload.replace === 'string' ? `replace:\n${payload.replace}` : undefined,
      typeof payload.replaceAll === 'boolean' ? `replaceAll: ${payload.replaceAll}` : undefined,
    ].filter(Boolean).join('\n');
    const errorLog = [
      `savedAt: ${savedAt}`,
      `projectId: ${payload.projectId}`,
      `inputTruncated: ${!!payload.input && payload.input.length > (trimmedInput?.length ?? 0)}`,
      '',
      `errorName: ${serializedError.name ?? 'Error'}`,
      `errorMessage: ${serializedError.message}`,
      serializedError.stack ? `errorStack:\n${serializedError.stack}` : undefined,
    ].filter(Boolean).join('\n');
    writeFileSync(path.join(failCaseDir, 'source.js'), payload.sourceContent, 'utf8');
    writeFileSync(path.join(failCaseDir, 'patch.diff'), trimmedInput ?? legacyPatchBody, 'utf8');
    writeFileSync(path.join(failCaseDir, 'error.log'), errorLog, 'utf8');
  } catch {
    /* best-effort only */
  }
}

export class InvalidContextError extends DiffError {
  readonly file: string;
  readonly kindForTelemetry: string;

  constructor(message: string, file: string, kindForTelemetry: string) {
    super(message);
    this.file = file;
    this.kindForTelemetry = kindForTelemetry;
  }
}

export class InvalidPatchFormatError extends DiffError {
  readonly kindForTelemetry: string;

  constructor(message: string, kindForTelemetry: string) {
    super(message);
    this.kindForTelemetry = kindForTelemetry;
  }
}

const Fuzz = {
  None: 0,
  IgnoredTrailingWhitespace: 1 << 1,
  NormalizedExplicitTab: 1 << 2,
  IgnoredWhitespace: 1 << 3,
  EditDistanceMatch: 1 << 4,
  IgnoredEofSignal: 1 << 5,
  MergedOperatorSection: 1 << 6,
  NormalizedExplicitNL: 1 << 7,
} as const;

type Fuzz = number;

interface FuzzMatch {
  line: number;
  fuzz: Fuzz;
}

interface IndentStyle {
  tabSize: number;
  insertSpaces: boolean;
}

export function parseApplyPatch(patch: string): ApplyPatchOp[] | null {
  if (!patch.startsWith(PATCH_PREFIX)) {
    return null;
  }
  if (!patch.endsWith(PATCH_SUFFIX)) {
    return null;
  }

  const patchBody = patch.slice(PATCH_PREFIX.length, patch.length - PATCH_SUFFIX.length);
  const lines = patchBody.split('\n');
  const ops: ApplyPatchOp[] = [];

  for (const line of lines) {
    if (line.startsWith(END_OF_FILE_PREFIX)) {
      continue;
    }
    if (line.startsWith(ADD_FILE_PREFIX)) {
      ops.push({ type: 'create', path: line.slice(ADD_FILE_PREFIX.length).trim(), content: '' });
      continue;
    }
    if (line.startsWith(DELETE_FILE_PREFIX)) {
      ops.push({ type: 'delete', path: line.slice(DELETE_FILE_PREFIX.length).trim() });
      continue;
    }
    if (line.startsWith(UPDATE_FILE_PREFIX)) {
      ops.push({ type: 'update', path: line.slice(UPDATE_FILE_PREFIX.length).trim(), update: '', added: 0, deleted: 0 });
      continue;
    }

    const lastOp = ops[ops.length - 1];
    if (lastOp?.type === 'create') {
      if (!line.startsWith(HUNK_ADD_LINE_PREFIX)) {
        return null;
      }
      lastOp.content = appendLine(lastOp.content, line.slice(HUNK_ADD_LINE_PREFIX.length));
      continue;
    }
    if (lastOp?.type !== 'update') {
      return null;
    }
    if (line.startsWith(HUNK_ADD_LINE_PREFIX)) {
      lastOp.added += 1;
    } else if (line.startsWith(HUNK_DELETE_LINE_PREFIX)) {
      lastOp.deleted += 1;
    }
    lastOp.update += lastOp.update ? `\n${line}` : line;
  }

  return ops;
}

class Parser {
  private readonly indentStyles: Record<string, IndentStyle>;
  private readonly patch: Patch = { actions: {} };
  private fuzz = 0;
  private index = 0;
  private readonly currentFiles: Record<string, string>;
  private readonly lines: string[];

  constructor(currentFiles: Record<string, string>, lines: string[]) {
    this.currentFiles = currentFiles;
    this.lines = lines;
    this.indentStyles = Object.fromEntries(
      Object.entries(currentFiles).map(([filePath, text]) => [filePath, guessIndentation(text.split('\n'))]),
    );
  }

  parse(): { patch: Patch; fuzz: number } {
    while (!this.isDone([PATCH_SUFFIX.trim()])) {
      let filePath = this.readString(UPDATE_FILE_PREFIX);
      if (filePath) {
        if (this.patch.actions[filePath]) throw new DiffError(`Update File Error: Duplicate Path: ${filePath}`);
        const moveTo = this.readString(MOVE_FILE_TO_PREFIX);
        if (!(filePath in this.currentFiles)) throw new DiffError(`Update File Error: Missing File: ${filePath}`);
        const action = this.parseUpdateFile(filePath, this.currentFiles[filePath], this.indentStyles[filePath]);
        action.movePath = moveTo || undefined;
        this.patch.actions[filePath] = action;
        continue;
      }

      filePath = this.readString(DELETE_FILE_PREFIX);
      if (filePath) {
        if (this.patch.actions[filePath]) throw new DiffError(`Delete File Error: Duplicate Path: ${filePath}`);
        if (!(filePath in this.currentFiles)) throw new DiffError(`Delete File Error: Missing File: ${filePath}`);
        this.patch.actions[filePath] = { type: ActionType.DELETE, chunks: [] };
        continue;
      }

      filePath = this.readString(ADD_FILE_PREFIX);
      if (filePath) {
        if (this.patch.actions[filePath]) throw new DiffError(`Add File Error: Duplicate Path: ${filePath}`);
        if (filePath in this.currentFiles) throw new DiffError(`Add File Error: File already exists: ${filePath}`);
        this.patch.actions[filePath] = this.parseAddFile();
        continue;
      }

      throw new InvalidPatchFormatError(`Invalid patch line: ${this.lines[this.index] ?? ''}`, 'invalidPatchLine');
    }

    return { patch: this.patch, fuzz: this.fuzz };
  }

  skipBeginPatch(): void {
    this.index = 1;
  }

  private isDone(prefixes?: string[]): boolean {
    if (this.index >= this.lines.length) return true;
    if (!prefixes) return false;
    return prefixes.some(prefix => this.lines[this.index]?.startsWith(prefix.trim()));
  }

  private readString(prefix = '', returnEverything = false): string {
    if (this.index >= this.lines.length) throw new InvalidPatchFormatError('Unexpected end of patch', 'unexpectedEndOfPatch');
    const current = this.lines[this.index] ?? '';
    if (!current.startsWith(prefix)) return '';
    this.index += 1;
    return returnEverything ? current : current.slice(prefix.length);
  }

  private parseUpdateFile(filePath: string, text: string, targetIndentStyle: IndentStyle): PatchAction {
    const action: PatchAction = { type: ActionType.UPDATE, chunks: [] };
    const fileLines = text.split('\n');
    const replaceExplicitTabsByDefault = !AVOID_EXPLICIT_TABS_REGEX.test(filePath.trimEnd());
    let searchIndex = 0;

    while (!this.isDone([PATCH_SUFFIX.trim(), UPDATE_FILE_PREFIX, DELETE_FILE_PREFIX, ADD_FILE_PREFIX, END_OF_FILE_PREFIX])) {
      const sectionLine = this.readString(CHUNK_DELIMITER, true);
      const defLine = sectionLine.slice(CHUNK_DELIMITER.length).trim();
      if (!(sectionLine || searchIndex === 0)) {
        throw new DiffError(`Invalid line. Consider splitting each change into individual apply-patch tool calls:\n${this.lines[this.index] ?? ''}`);
      }

      if (defLine) {
        const nextSearchIndex = findDefinitionIndex(fileLines, defLine, searchIndex);
        if (nextSearchIndex !== undefined) {
          if (nextSearchIndex > searchIndex) this.fuzz += 1;
          searchIndex = nextSearchIndex;
        }
      }

      let nextSection = peekNextSection(this.lines, this.index);
      let match: FuzzMatch | undefined;
      for (let mergeNo = 0; mergeNo <= nextSection.fuzzMerges && !match; mergeNo += 1) {
        if (mergeNo > 0) nextSection = peekNextSection(this.lines, this.index, mergeNo);
        match = findContext(fileLines, nextSection.nextChunkContext, searchIndex, nextSection.eof);
        if (!match) match = findContext(fileLines, nextSection.nextChunkContext, 0, nextSection.eof);
        if (mergeNo > 0 && match) match.fuzz |= Fuzz.MergedOperatorSection;
      }

      if (!match) {
        const contextText = nextSection.nextChunkContext.join('\n');
        if (nextSection.eof) {
          throw new InvalidContextError(`Invalid EOF context at line ${searchIndex}:\n${contextText}`, text, 'invalidContext-eof');
        }
        throw new InvalidContextError(`Invalid context at line ${searchIndex}:\n${contextText}`, text, 'invalidContext');
      }

      this.fuzz += match.fuzz;
      const srcIndentStyle = guessIndentation([...nextSection.chunks.flatMap(chunk => chunk.insLines), ...nextSection.nextChunkContext], targetIndentStyle.tabSize, targetIndentStyle.insertSpaces);
      const matchedLineIndent = computeIndentLevel(fileLines[match.line], targetIndentStyle.tabSize);
      const normalizedContextLine = (match.fuzz & Fuzz.NormalizedExplicitTab)
        ? replaceExplicitTabs(nextSection.nextChunkContext[0] ?? '')
        : (match.fuzz & Fuzz.NormalizedExplicitNL)
          ? replaceExplicitNl(nextSection.nextChunkContext[0] ?? '')
          : (nextSection.nextChunkContext[0] ?? '');
      const srcLineIndent = nextSection.nextChunkContext.length > 0 ? computeIndentLevel(normalizedContextLine, srcIndentStyle.tabSize) : 0;
      const additionalIndentation = buildIndent(Math.max(0, matchedLineIndent - srcLineIndent), targetIndentStyle);

      for (const chunk of nextSection.chunks) {
        chunk.origIndex += match.line;
        if (match.fuzz & Fuzz.NormalizedExplicitNL) {
          chunk.insLines = chunk.insLines.map(replaceExplicitNl);
          chunk.delLines = chunk.delLines.map(replaceExplicitNl);
        }
        if (replaceExplicitTabsByDefault || (match.fuzz & Fuzz.NormalizedExplicitTab)) {
          chunk.insLines = chunk.insLines.map(replaceExplicitTabs);
        }
        chunk.insLines = chunk.insLines.map(line => isFalsyOrWhitespace(line) ? line : additionalIndentation + transformIndentation(line, srcIndentStyle, targetIndentStyle));
        if (match.fuzz & Fuzz.NormalizedExplicitTab) {
          chunk.delLines = chunk.delLines.map(replaceExplicitTabs);
        }
        action.chunks.push(chunk);
      }

      searchIndex = match.line + nextSection.nextChunkContext.length;
      this.index = nextSection.endPatchIndex;
    }

    return action;
  }

  private parseAddFile(): PatchAction {
    const lines: string[] = [];
    while (!this.isDone([PATCH_SUFFIX.trim(), UPDATE_FILE_PREFIX, DELETE_FILE_PREFIX, ADD_FILE_PREFIX])) {
      const line = this.readString();
      if (!line.startsWith(HUNK_ADD_LINE_PREFIX)) {
        throw new InvalidPatchFormatError(`Invalid Add File Line: ${line}`, 'invalidAddFileLine');
      }
      lines.push(line.slice(1));
    }
    return { type: ActionType.ADD, newFile: lines.join('\n'), chunks: [] };
  }
}

function appendLine(content: string, line: string): string {
  return content.length ? `${content}\n${line}` : line;
}

function canon(value: string): string {
  return value.normalize('NFC').replace(/./gu, char => PUNCT_EQUIV[char] ?? char);
}

function countOccurrences(text: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let start = 0;
  while (true) {
    const index = text.indexOf(search, start);
    if (index === -1) return count;
    count += 1;
    start = index + search.length;
  }
}

function isFalsyOrWhitespace(value: string): boolean {
  return !value || !/\S/.test(value);
}

function guessIndentation(lines: string[], fallbackTabSize = 2, fallbackInsertSpaces = true): IndentStyle {
  let tabIndented = 0;
  const spaceCounts: number[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('\t')) {
      tabIndented += 1;
      continue;
    }
    const match = line.match(/^( +)/);
    if (match?.[1]?.length) {
      spaceCounts.push(match[1].length);
    }
  }

  if (tabIndented > spaceCounts.length) {
    return { tabSize: fallbackTabSize, insertSpaces: false };
  }

  const tabSize = spaceCounts.length ? Math.max(1, Math.min(...spaceCounts.filter(Boolean))) : fallbackTabSize;
  return { tabSize, insertSpaces: fallbackInsertSpaces };
}

function computeIndentLevel(line = '', tabSize: number): number {
  let width = 0;
  for (const char of line.match(/^\s*/)?.[0] ?? '') {
    width += char === '\t' ? tabSize : 1;
  }
  return width;
}

function buildIndent(width: number, style: IndentStyle): string {
  if (width <= 0) return '';
  if (style.insertSpaces) return ' '.repeat(width);
  const tabs = Math.floor(width / style.tabSize);
  const spaces = width % style.tabSize;
  return '\t'.repeat(tabs) + ' '.repeat(spaces);
}

function transformIndentation(line: string, source: IndentStyle, target: IndentStyle): string {
  const leading = line.match(/^\s*/)?.[0] ?? '';
  const width = computeIndentLevel(leading, source.tabSize);
  return buildIndent(width, target) + line.slice(leading.length);
}

function replaceExplicitTabs(value: string): string {
  return value.replace(/^(?:\s|\\t|\/|#)*/gm, prefix => prefix.replaceAll('\\t', '\t'));
}

function replaceExplicitNl(value: string): string {
  return replaceExplicitTabs(value.replaceAll('\\n', '\n'));
}

function levenshteinDistance(a = '', b = ''): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1);
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

function findDefinitionIndex(lines: string[], defLine: string, start: number): number | undefined {
  const exact = canon(defLine);
  if (!lines.slice(0, start).some(line => canon(line) === exact)) {
    for (let index = start; index < lines.length; index += 1) {
      if (canon(lines[index]) === exact) return index + 1;
    }
  }
  const trimmed = canon(defLine.trim());
  if (!lines.slice(0, start).some(line => canon(line.trim()) === trimmed)) {
    for (let index = start; index < lines.length; index += 1) {
      if (canon(lines[index].trim()) === trimmed) return index + 1;
    }
  }
  return undefined;
}

function findContextCore(lines: string[], context: string[], start: number): FuzzMatch | undefined {
  if (!context.length) return { line: start, fuzz: Fuzz.None };

  const exactContext = context.map(canon);
  const exactLines = lines.map(canon);
  for (let index = start; index < exactLines.length; index += 1) {
    if (exactLines.slice(index, index + exactContext.length).join('\n') === exactContext.join('\n')) {
      return { line: index, fuzz: Fuzz.None };
    }
  }

  const trailingContext = exactContext.map(line => line.trimEnd());
  const trailingLines = exactLines.map(line => line.trimEnd());
  let fuzz = Fuzz.IgnoredTrailingWhitespace;
  for (let index = start; index < trailingLines.length; index += 1) {
    if (trailingLines.slice(index, index + trailingContext.length).join('\n') === trailingContext.join('\n')) {
      return { line: index, fuzz };
    }
  }

  const explicitTabContext = trailingContext.map(replaceExplicitTabs);
  const explicitTabLines = trailingLines.map(replaceExplicitTabs);
  if (explicitTabContext.join('\n') !== trailingContext.join('\n')) {
    fuzz |= Fuzz.NormalizedExplicitTab;
    for (let index = start; index < explicitTabLines.length; index += 1) {
      if (explicitTabLines.slice(index, index + explicitTabContext.length).join('\n') === explicitTabContext.join('\n')) {
        return { line: index, fuzz };
      }
    }
  }

  if (context.length === 1) {
    const explicitNlContext = replaceExplicitNl(explicitTabContext[0]);
    if (explicitNlContext !== explicitTabContext[0]) {
      const expandedContext = explicitNlContext.split('\n');
      const explicitNlLines = explicitTabLines.map(replaceExplicitNl);
      for (let index = start; index < explicitNlLines.length; index += 1) {
        if (explicitNlLines.slice(index, index + expandedContext.length).join('\n') === expandedContext.join('\n')) {
          return { line: index, fuzz: fuzz | Fuzz.NormalizedExplicitNL | Fuzz.NormalizedExplicitTab };
        }
      }
    }
  }

  const whitespaceContext = explicitTabContext.map(line => line.trim());
  const whitespaceLines = explicitTabLines.map(line => line.trim());
  fuzz |= Fuzz.IgnoredWhitespace;
  for (let index = start; index < whitespaceLines.length; index += 1) {
    if (whitespaceLines.slice(index, index + whitespaceContext.length).join('\n') === whitespaceContext.join('\n')) {
      return { line: index, fuzz };
    }
  }

  const maxDistance = Math.floor(context.length * EDIT_DISTANCE_ALLOWANCE_PER_LINE);
  if (maxDistance > 0) {
    fuzz |= Fuzz.EditDistanceMatch;
    for (let index = start; index < whitespaceLines.length; index += 1) {
      let totalDistance = 0;
      for (let offset = 0; offset < whitespaceContext.length && totalDistance <= maxDistance; offset += 1) {
        totalDistance += levenshteinDistance(whitespaceLines[index + offset] ?? '', whitespaceContext[offset] ?? '');
      }
      if (totalDistance <= maxDistance) {
        return { line: index, fuzz };
      }
    }
  }

  return undefined;
}

function findContext(lines: string[], context: string[], start: number, eof: boolean): FuzzMatch | undefined {
  if (eof) {
    const endMatch = findContextCore(lines, context, Math.max(0, lines.length - context.length));
    if (endMatch) return endMatch;
    const fallback = findContextCore(lines, context, start);
    if (fallback) {
      fallback.fuzz |= Fuzz.IgnoredEofSignal;
      return fallback;
    }
  }
  return findContextCore(lines, context, start);
}

function peekNextSection(lines: string[], initialIndex: number, fuzzMerge = 0): { nextChunkContext: string[]; chunks: Chunk[]; endPatchIndex: number; eof: boolean; fuzzMerges: number } {
  const Mode = {
    Add: 'add',
    Delete: 'delete',
    Keep: 'keep',
  } as const;
  type Mode = (typeof Mode)[keyof typeof Mode];

  let index = initialIndex;
  const old: string[] = [];
  let delLines: string[] = [];
  let insLines: string[] = [];
  const chunks: Chunk[] = [];
  let mode: Mode = Mode.Keep;
  let fuzzMergeNo = 0;

  while (index < lines.length) {
    const current = lines[index] ?? '';
    if ([CHUNK_DELIMITER, PATCH_SUFFIX.trim(), UPDATE_FILE_PREFIX, DELETE_FILE_PREFIX, ADD_FILE_PREFIX, END_OF_FILE_PREFIX].some(prefix => current.startsWith(prefix.trim()))) {
      if (mode === Mode.Keep && old.length && !/\S/.test(old[old.length - 1] ?? '')) {
        old.pop();
      }
      break;
    }
    if (current === '***') break;
    if (current.startsWith('***')) throw new InvalidPatchFormatError(`Invalid Line: ${current}`, 'invalidLine');

    index += 1;
    const previousMode: Mode = mode;
    let line = current;
    if (line[0] === HUNK_ADD_LINE_PREFIX) {
      mode = Mode.Add;
    } else if (line[0] === HUNK_DELETE_LINE_PREFIX) {
      mode = Mode.Delete;
    } else if (line[0] === ' ') {
      mode = Mode.Keep;
    } else {
      const nextLine = lines[index] ?? '';
      const nextMode = nextLine[0] === HUNK_ADD_LINE_PREFIX ? Mode.Add : nextLine[0] === HUNK_DELETE_LINE_PREFIX ? Mode.Delete : Mode.Keep;
      const canFuzz = mode !== Mode.Keep && nextMode === mode;
      mode = Mode.Keep;
      line = ` ${line}`;
      if (canFuzz) {
        fuzzMergeNo += 1;
        if (fuzzMerge === fuzzMergeNo) mode = nextMode;
      }
    }

    line = line.slice(1);
    if (mode === Mode.Keep && previousMode !== mode) {
      if (insLines.length || delLines.length) {
        chunks.push({ origIndex: old.length - delLines.length, delLines, insLines });
      }
      delLines = [];
      insLines = [];
    }

    if (mode === Mode.Delete) {
      delLines.push(line);
      old.push(line);
    } else if (mode === Mode.Add) {
      insLines.push(line);
    } else {
      old.push(line);
    }
  }

  if (insLines.length || delLines.length) {
    chunks.push({ origIndex: old.length - delLines.length, delLines, insLines });
  }

  if (index < lines.length && lines[index] === END_OF_FILE_PREFIX) {
    index += 1;
    return { nextChunkContext: old, chunks, endPatchIndex: index, eof: true, fuzzMerges: fuzzMergeNo };
  }

  return { nextChunkContext: old, chunks, endPatchIndex: index, eof: false, fuzzMerges: fuzzMergeNo };
}

export function textToPatch(text: string, originalFiles: Record<string, string>): { patch: Patch; fuzz: number } {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new InvalidPatchFormatError('Invalid patch text', 'invalidPatchText');
  if (!(lines[0] ?? '').startsWith(PATCH_PREFIX.trim())) {
    throw new InvalidPatchFormatError(`Invalid patch text. Patch must start with ${PATCH_PREFIX.trim()}.`, 'invalidPatchTextPrefix');
  }
  if ((lines[lines.length - 1] ?? '') !== PATCH_SUFFIX.trim()) {
    lines.push(PATCH_SUFFIX.trim());
  }
  const parser = new Parser(originalFiles, lines);
  parser.skipBeginPatch();
  return parser.parse();
}

export function identifyFilesNeeded(text: string): string[] {
  const result = new Set<string>();
  for (const line of text.trim().split('\n')) {
    if (line.startsWith(UPDATE_FILE_PREFIX)) result.add(line.slice(UPDATE_FILE_PREFIX.length));
    if (line.startsWith(DELETE_FILE_PREFIX)) result.add(line.slice(DELETE_FILE_PREFIX.length));
  }
  return [...result];
}

export function collectApplyPatchSourceContent(projectRoot: string, input: string): string {
  const neededFiles = identifyFilesNeeded(input);
  if (neededFiles.length === 0) {
    return '';
  }

  const entries = neededFiles.flatMap(filePath => {
    let resolved: string;
    try {
      resolved = resolvePatchPath(projectRoot, filePath);
    } catch (error) {
      if (!(error instanceof InvalidPatchFormatError)) {
        throw error;
      }
      return [];
    }
    if (!existsSync(resolved)) {
      return [];
    }
    return [{
      relativePath: path.relative(projectRoot, resolved).replace(/\\/g, '/'),
      content: readFileSync(resolved, 'utf8'),
    }];
  });

  if (entries.length === 1 && neededFiles.length === 1) {
    const [entry] = entries;
    return entry.content;
  }

  return entries.map(({ relativePath, content }) => `// ${relativePath}\n${content}`).join('\n\n');
}

function getUpdatedFile(text: string, action: PatchAction, filePath: string): string {
  if (action.type !== ActionType.UPDATE) throw new Error('Expected UPDATE action');
  const originalLines = text.split('\n');
  const output: string[] = [];
  let originalIndex = 0;

  for (const chunk of action.chunks) {
    if (chunk.origIndex > originalLines.length) {
      throw new DiffError(`${filePath}: chunk.origIndex ${chunk.origIndex} > len(lines) ${originalLines.length}`);
    }
    if (originalIndex > chunk.origIndex) {
      throw new DiffError(`${filePath}: origIndex ${originalIndex} > chunk.origIndex ${chunk.origIndex}`);
    }
    output.push(...originalLines.slice(originalIndex, chunk.origIndex));
    originalIndex = chunk.origIndex;
    output.push(...chunk.insLines);
    originalIndex += chunk.delLines.length;
  }

  output.push(...originalLines.slice(originalIndex));
  return output.join('\n');
}

export function patchToCommit(patch: Patch, originalFiles: Record<string, string>): Commit {
  const commit: Commit = { changes: {} };
  for (const [filePath, action] of Object.entries(patch.actions)) {
    if (action.type === ActionType.DELETE) {
      commit.changes[filePath] = { type: ActionType.DELETE, oldContent: originalFiles[filePath] };
    } else if (action.type === ActionType.ADD) {
      commit.changes[filePath] = { type: ActionType.ADD, newContent: action.newFile ?? '' };
    } else {
      const currentText = originalFiles[filePath];
      commit.changes[filePath] = {
        type: ActionType.UPDATE,
        oldContent: currentText,
        newContent: getUpdatedFile(currentText, action, filePath),
        movePath: action.movePath,
      };
    }
  }
  return commit;
}

function resolvePatchPath(projectRoot: string, filePath: string): string {
  const trimmed = filePath.trim();
  const normalizedRoot = path.resolve(projectRoot);
  const normalizedPath = trimmed.replace(/\\/g, '/');
  const absolutePath = path.isAbsolute(trimmed) && path.resolve(trimmed).startsWith(`${normalizedRoot}${path.sep}`)
    ? path.resolve(trimmed)
    : path.resolve(normalizedRoot, normalizedPath.replace(/^\/+/, ''));
  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new InvalidPatchFormatError(`Patch path is outside of the current project: ${filePath}`, 'patchPathOutsideProject');
  }
  return absolutePath;
}

function relativeProjectPath(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, resolvePatchPath(projectRoot, filePath)).replace(/\\/g, '/');
}

function assertAllowedChange(projectRoot: string, filePath: string, change: 'delete' | 'move-from' | 'move-to'): void {
  const relativePath = relativeProjectPath(projectRoot, filePath);
  if (relativePath === 'index.js' && change !== 'move-to') {
    throw new InvalidPatchFormatError('不能删除或重命名 index.js', 'restrictedIndexFileChange');
  }
  if (relativePath === 'index.js' && change === 'move-to') {
    throw new InvalidPatchFormatError('不能将其他文件移动为 index.js', 'restrictedIndexFileTarget');
  }
}

export function applyProjectPatch(projectRoot: string, input: string): AppliedPatchSummary {
  if (!input.startsWith(PATCH_PREFIX)) {
    throw new InvalidPatchFormatError(`Patch must start with ${PATCH_PREFIX.trim()}`, 'patchMustStartWithBeginPatch');
  }

  const neededFiles = identifyFilesNeeded(input);
  const originals: Record<string, string> = {};
  for (const filePath of neededFiles) {
    const resolved = resolvePatchPath(projectRoot, filePath);
    if (!existsSync(resolved)) {
      throw new DiffError(`File not found: ${filePath}`);
    }
    originals[filePath] = readFileSync(resolved, 'utf8');
  }

  const { patch, fuzz } = textToPatch(input, originals);
  const commit = patchToCommit(patch, originals);
  const summary: AppliedPatchSummary = {
    changedFiles: [],
    createdFiles: [],
    deletedFiles: [],
    updatedFiles: [],
    movedFiles: [],
    fuzz,
  };

  for (const [filePath, change] of Object.entries(commit.changes)) {
    const resolved = resolvePatchPath(projectRoot, filePath);
    const relativePath = path.relative(projectRoot, resolved).replace(/\\/g, '/');

    if (change.type === ActionType.DELETE) {
      assertAllowedChange(projectRoot, filePath, 'delete');
      rmSync(resolved, { recursive: true, force: true });
      summary.changedFiles.push(relativePath);
      summary.deletedFiles.push(relativePath);
      continue;
    }

    if (change.type === ActionType.ADD) {
      mkdirSync(path.dirname(resolved), { recursive: true });
      writeFileSync(resolved, change.newContent ?? '', 'utf8');
      summary.changedFiles.push(relativePath);
      summary.createdFiles.push(relativePath);
      continue;
    }

    if (change.movePath) {
      assertAllowedChange(projectRoot, filePath, 'move-from');
      assertAllowedChange(projectRoot, change.movePath, 'move-to');
      const movedResolved = resolvePatchPath(projectRoot, change.movePath);
      mkdirSync(path.dirname(movedResolved), { recursive: true });
      writeFileSync(movedResolved, change.newContent ?? '', 'utf8');
      rmSync(resolved, { recursive: true, force: true });
      const movedRelative = path.relative(projectRoot, movedResolved).replace(/\\/g, '/');
      summary.changedFiles.push(relativePath, movedRelative);
      summary.updatedFiles.push(movedRelative);
      summary.movedFiles.push({ from: relativePath, to: movedRelative });
      continue;
    }

    writeFileSync(resolved, change.newContent ?? '', 'utf8');
    summary.changedFiles.push(relativePath);
    summary.updatedFiles.push(relativePath);
  }

  summary.changedFiles = [...new Set(summary.changedFiles)].sort();
  summary.createdFiles.sort();
  summary.deletedFiles.sort();
  summary.updatedFiles.sort();
  summary.movedFiles.sort((a, b) => a.from.localeCompare(b.from));
  return summary;
}

export function applyLegacySearchReplace(original: string, search: string, replace: string, replaceAll?: boolean): string {
  if (!original.includes(search)) {
    throw new Error('找不到需要替换的内容');
  }
  return replaceAll ? original.split(search).join(replace) : original.replace(search, replace);
}

export function buildLegacyPatch(projectRoot: string, fileName: string, search: string, replace: string, replaceAll?: boolean): string {
  const targetPath = path.resolve(projectRoot, fileName);
  const original = readFileSync(targetPath, 'utf8');
  const updated = applyLegacySearchReplace(original, search, replace, replaceAll);
  if (updated === original) {
    throw new InvalidPatchFormatError('Legacy replacement produced no changes', 'legacyNoopPatch');
  }
  return [
    '*** Begin Patch',
    `*** Delete File: ${targetPath}`,
    `*** Add File: ${targetPath}`,
    ...updated.split('\n').map(line => `+${line}`),
    '*** End Patch',
  ].join('\n');
}
