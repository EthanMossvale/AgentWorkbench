/** Decode a top-level string field incrementally; final JSON validation remains mandatory. */
export class JsonInputStream {
  constructor(private readonly field = 'input') {}
  private depth = 0;
  private key = '';
  private expectKey = false;
  private expectValue = false;
  private mode: 'key' | 'value' | 'other' | undefined;
  private raw = '';
  private escape = '';
  private escaped = false;
  value = '';

  push(delta: string): string {
    let output = '';
    for (const c of delta) {
      if (this.mode) {
        if (this.mode === 'value') {
          if (this.escape) {
            this.escape += c;
            if (this.escape === '\\u' || this.escape.startsWith('\\u') && this.escape.length < 6) continue;
            output += JSON.parse('"' + this.escape + '"'); this.escape = ''; continue;
          }
          if (c === '\\') { this.escape = c; continue; }
          if (c !== '"') { output += c; continue; }
        } else {
          this.raw += c;
          if (this.escaped) { this.escaped = false; continue; }
          if (c === '\\') { this.escaped = true; continue; }
          if (c !== '"') continue;
          if (this.mode === 'key') this.key = JSON.parse('"' + this.raw);
        }
        this.mode = undefined; this.raw = ''; continue;
      }
      if (/\s/.test(c)) continue;
      if (c === '"') {
        this.mode = this.depth === 1 && this.expectKey ? 'key' : this.depth === 1 && this.expectValue && this.key === this.field ? 'value' : 'other';
        this.expectKey = false; this.expectValue = false; this.raw = ''; continue;
      }
      if (c === '{' || c === '[') { this.depth++; this.expectKey = this.depth === 1 && c === '{'; this.expectValue = false; }
      else if (c === '}' || c === ']') this.depth--;
      else if (this.depth === 1 && c === ',') { this.expectKey = true; this.expectValue = false; }
      else if (this.depth === 1 && c === ':') this.expectValue = true;
    }
    this.value += output;
    return output;
  }
}
