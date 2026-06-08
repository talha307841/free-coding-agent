import * as vscode from 'vscode';

export interface DiffFilePatch {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export interface PendingDiff {
  edit: vscode.WorkspaceEdit;
  previewOriginal: vscode.Uri;
  previewModified: vscode.Uri;
  title: string;
}

export interface DiffLineStats {
  added: number;
  removed: number;
}

function normalizePath(path: string): string {
  return path.replace(/^a\//, '').replace(/^b\//, '').trim();
}

export function extractUnifiedDiff(text: string): string | undefined {
  // First, check for fenced ```diff``` blocks
  const fencedMatch = text.match(/```diff\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  // If no fence, try to locate a unified diff by looking for the ---/+++ markers.
  // Some model outputs include extra text before/after the actual diff; grab from
  // the first '--- ' marker until the end so we don't miss hunks.
  const firstDash = text.indexOf('--- ');
  const hasPlus = text.indexOf('+++ ') !== -1;
  if (firstDash !== -1 && hasPlus) {
    return text.slice(firstDash).trim();
  }

  return undefined;
}

export function parseUnifiedDiff(diffText: string): DiffFilePatch[] {
  const lines = diffText.split(/\r?\n/);
  const patches: DiffFilePatch[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].startsWith('--- ')) {
      i += 1;
      continue;
    }

    const oldPath = normalizePath(lines[i].slice(4));
    const plusLine = lines[i + 1] ?? '';
    if (!plusLine.startsWith('+++ ')) {
      i += 1;
      continue;
    }
    const newPath = normalizePath(plusLine.slice(4));
    i += 2;

    const hunks: DiffHunk[] = [];
    while (i < lines.length && !lines[i].startsWith('--- ')) {
      const header = lines[i];
      const hunkMatch = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!hunkMatch) {
        i += 1;
        continue;
      }

      const oldStart = Number(hunkMatch[1]);
      const oldCount = Number(hunkMatch[2] ?? '1');
      const newStart = Number(hunkMatch[3]);
      const newCount = Number(hunkMatch[4] ?? '1');
      i += 1;

      const hunkLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith('@@ ') && !lines[i].startsWith('--- ')) {
        hunkLines.push(lines[i]);
        i += 1;
      }

      hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
    }

    patches.push({ oldPath, newPath, hunks });
  }

  return patches;
}

export function computePatchStats(patch: DiffFilePatch): DiffLineStats {
  let added = 0;
  let removed = 0;
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        added += 1;
      }
      if (line.startsWith('-')) {
        removed += 1;
      }
    }
  }
  return { added, removed };
}

export function serializePatch(patch: DiffFilePatch): string {
  const output: string[] = [];
  output.push(`--- a/${patch.oldPath}`);
  output.push(`+++ b/${patch.newPath}`);
  for (const hunk of patch.hunks) {
    output.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
    output.push(...hunk.lines);
  }
  return output.join('\n');
}

function applyHunksToText(original: string, hunks: DiffHunk[]): string {
  const source = original.split(/\r?\n/);
  const output: string[] = [];
  let srcIdx = 0;

  for (const hunk of hunks) {
    const targetIdx = Math.max(0, hunk.oldStart - 1);
    while (srcIdx < targetIdx && srcIdx < source.length) {
      output.push(source[srcIdx]);
      srcIdx += 1;
    }

    for (const line of hunk.lines) {
      if (line.startsWith(' ')) {
        output.push(line.slice(1));
        srcIdx += 1;
      } else if (line.startsWith('-')) {
        srcIdx += 1;
      } else if (line.startsWith('+')) {
        output.push(line.slice(1));
      } else if (line.startsWith('\\')) {
        // No-op metadata line.
      }
    }
  }

  while (srcIdx < source.length) {
    output.push(source[srcIdx]);
    srcIdx += 1;
  }

  return output.join('\n');
}

export function applyPatchToText(original: string, patch: DiffFilePatch): string {
  return applyHunksToText(original, patch.hunks);
}

export async function buildWorkspaceEditFromDiff(diffText: string): Promise<vscode.WorkspaceEdit> {
  const patches = parseUnifiedDiff(diffText);
  const edit = new vscode.WorkspaceEdit();

  for (const patch of patches) {
    const targetPath = patch.newPath || patch.oldPath;
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0].uri ?? vscode.Uri.file('.'), targetPath);
    let original = '';
    let exists = true;

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      original = Buffer.from(bytes).toString('utf8');
    } catch {
      // File doesn't exist on disk yet
      exists = false;
      original = '';
    }

    const updated = applyHunksToText(original, patch.hunks);

    if (!exists) {
      // Create the file and insert content
      try {
        edit.createFile(uri, { overwrite: true });
      } catch {
        // ignore
      }
      edit.insert(uri, new vscode.Position(0, 0), updated);
    } else {
      const fullRange = new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
      edit.replace(uri, fullRange, updated);
    }
  }

  return edit;
}

export async function createDiffPreview(diffText: string, title: string): Promise<PendingDiff | undefined> {
  const patches = parseUnifiedDiff(diffText);
  if (patches.length === 0) {
    return undefined;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) {
    return undefined;
  }

  const firstPatch = patches[0];
  const firstPath = firstPatch.newPath || firstPatch.oldPath;
  const targetUri = vscode.Uri.joinPath(workspaceRoot, firstPath);

  let original = '';
  try {
    const bytes = await vscode.workspace.fs.readFile(targetUri);
    original = Buffer.from(bytes).toString('utf8');
  } catch {
    original = '';
  }

  const updated = applyHunksToText(original, firstPatch.hunks);

  const previewFolder = vscode.Uri.joinPath(workspaceRoot, '.nimcoder-preview');
  await vscode.workspace.fs.createDirectory(previewFolder);

  const stamp = Date.now();
  const previewOriginal = vscode.Uri.joinPath(previewFolder, `original-${stamp}.txt`);
  const previewModified = vscode.Uri.joinPath(previewFolder, `modified-${stamp}.txt`);

  await vscode.workspace.fs.writeFile(previewOriginal, Buffer.from(original, 'utf8'));
  await vscode.workspace.fs.writeFile(previewModified, Buffer.from(updated, 'utf8'));

  const edit = await buildWorkspaceEditFromDiff(diffText);

  return {
    edit,
    previewOriginal,
    previewModified,
    title
  };
}
