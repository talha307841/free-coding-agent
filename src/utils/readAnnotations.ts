export interface ReadAnnotation {
  filePath: string;
  startLine: number;
  endLine: number;
  summary: string;
  languageTag: string;
}

function extension(filePath: string): string {
  const idx = filePath.lastIndexOf('.');
  return idx === -1 ? '' : filePath.slice(idx).toLowerCase();
}

export function languageTagForPath(filePath: string): string {
  const ext = extension(filePath);
  if (ext === '.py') {
    return 'python';
  }
  if (ext === '.ts' || ext === '.tsx') {
    return 'typescript';
  }
  if (ext === '.js' || ext === '.jsx') {
    return 'javascript';
  }
  if (ext === '.json') {
    return 'json';
  }
  if (ext === '.md') {
    return 'markdown';
  }
  if (ext === '.html') {
    return 'html';
  }
  if (ext === '.css') {
    return 'css';
  }
  return 'text';
}

export function summarizeReadSnippet(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const first = lines[0] ?? 'No significant code found';
  if (first.length <= 88) {
    return first;
  }
  return `${first.slice(0, 85)}...`;
}

export function createReadAnnotation(
  filePath: string,
  startLine: number,
  endLine: number,
  content: string
): ReadAnnotation {
  const safeStart = Math.max(1, startLine);
  const safeEnd = Math.max(safeStart, endLine);
  return {
    filePath,
    startLine: safeStart,
    endLine: safeEnd,
    summary: summarizeReadSnippet(content),
    languageTag: languageTagForPath(filePath)
  };
}
