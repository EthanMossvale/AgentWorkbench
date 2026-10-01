import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { childPath, noLinks, optionalText } from '../native-resources/files';

function scalar(raw: string) {
  const value = raw.trim();
  if (value.startsWith('"')) { const quoted = /^"(?:\\.|[^"\\])*"/.exec(value)?.[0]; return quoted ? String(JSON.parse(quoted)) : ''; }
  if (value.startsWith("'")) return /^'((?:''|[^'])*)'/.exec(value)?.[1]?.replaceAll("''", "'") ?? '';
  return /^[!&*[{]/.test(value) ? '' : value.replace(/\s+#.*$/, '').trim();
}
/** Read display-only scalar fields; never evaluate YAML tags, anchors or plugin code. */
export function interfaceFields(yaml: string): Record<string, string> {
  const lines = yaml.replace(/^\uFEFF/, '').split(/\r?\n/), result: Record<string, string> = {};
  let inside = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^interface:\s*(?:#.*)?$/.test(line)) { inside = true; continue; }
    if (inside && /^\S/.test(line) && !line.startsWith('#')) break;
    const match = inside ? /^  (display_name|short_description|icon_small|icon_large):\s*(.*)$/.exec(line) : null;
    if (!match) continue;
    let value = match[2]!;
    if (/^[>|][-+]?\s*$/.test(value)) { const body = []; while (index + 1 < lines.length && /^    /.test(lines[index + 1]!)) body.push(lines[++index]!.trim()); value = body.join(' '); }
    else value = scalar(value);
    if (value && value.length <= 2048) result[match[1]!] = value.replace(/\s+/g, ' ').trim();
  }
  return result;
}
export async function readSkillDisplay(directory: string): Promise<{ displayName?: string; shortDescription?: string; icon?: string }> {
  let values: Record<string, string>;
  try { values = interfaceFields(await optionalText(path.join(directory, 'agents', 'openai.yaml'), 64 * 1024) ?? ''); }
  catch { return {}; }
  const result: { displayName?: string; shortDescription?: string; icon?: string } = { displayName: values.display_name, shortDescription: values.short_description };
  const icon = values.icon_small ?? values.icon_large;
  if (icon) try {
    const file = childPath(directory, icon.replace(/^\.\//, '')); await noLinks(file);
    const info = await lstat(file); if (!info.isFile() || info.size > 256 * 1024) return result;
    const extension = path.extname(file).toLowerCase(), mime = ({ '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' } as Record<string, string>)[extension];
    if (!mime) return result;
    const data = await readFile(file);
    if (extension === '.svg' && (!/<svg\b/i.test(data.toString()) || /<(?:script|foreignObject)|\bon\w+\s*=|<!DOCTYPE|<!ENTITY|@import|(?:href\s*=\s*["']\s*(?!#))|url\(\s*(?!#)/i.test(data.toString()))) return result;
    result.icon = `data:${mime};base64,${data.toString('base64')}`;
  } catch { /* Optional native icon errors use the generic Skill icon. */ }
  return result;
}
