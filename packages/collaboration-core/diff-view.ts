export interface DiffLine { kind: 'context'|'added'|'removed'|'meta'; text: string; oldLine?: number; newLine?: number }
export interface SplitDiffLine { left?: DiffLine; right?: DiffLine; meta?: DiffLine }
/** Missing hunk positions stay unknown; fragment offsets are never file line numbers. */
export function diffLines(patch: string): DiffLine[] {
  let oldLine: number | undefined, newLine: number | undefined, inHunk = false;
  const lines = patch.split(/\r?\n/); if (lines.at(-1) === '') lines.pop();
  return lines.map(text => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (text.startsWith('@@')) { inHunk = true; oldLine = hunk ? Number(hunk[1]) : undefined; newLine = hunk ? Number(hunk[2]) : undefined; return {kind:'meta',text}; }
    if (text.startsWith('diff --git ')) { inHunk = false; oldLine = newLine = undefined; }
    if (!inHunk && /^(?:--- |\+\+\+ |diff |index |\*\*\* |Binary |GIT binary)/.test(text) || text.startsWith('\\')) return {kind:'meta',text};
    const kind = text.startsWith('+') ? 'added' : text.startsWith('-') ? 'removed' : text.startsWith(' ') ? 'context' : 'meta';
    const line: DiffLine = {kind,text:kind === 'meta' ? text : text.slice(1)};
    if (kind === 'context' || kind === 'removed') { line.oldLine = oldLine; if (oldLine !== undefined) oldLine++; }
    if (kind === 'context' || kind === 'added') { line.newLine = newLine; if (newLine !== undefined) newLine++; }
    return line;
  });
}
/** Align adjacent removed/added blocks without inventing intra-line correspondences. */
export function splitDiffLines(lines: DiffLine[]): SplitDiffLine[] {
  const rows: SplitDiffLine[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (line.kind === 'meta') { rows.push({meta:line}); i++; }
    else if (line.kind === 'context') { rows.push({left:line,right:line}); i++; }
    else {
      const left: DiffLine[] = [], right: DiffLine[] = [];
      while (i < lines.length && ['added','removed'].includes(lines[i]!.kind)) { const next = lines[i++]!; (next.kind === 'removed' ? left : right).push(next); }
      for (let j = 0; j < Math.max(left.length,right.length); j++) rows.push({left:left[j],right:right[j]});
    }
  }
  return rows;
}
