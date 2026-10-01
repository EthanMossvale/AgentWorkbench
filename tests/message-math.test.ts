import test from 'node:test';
import assert from 'node:assert/strict';
import type { Token } from 'marked';
import { markdownTokens, markdownBlocks, markdownCode, markdownText, markdownMath, markdownApi, type MarkdownMathToken } from '../packages/message-markdown';

function mathTokens(source: string): MarkdownMathToken[] {
  const math: MarkdownMathToken[] = [];
  const walk = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === 'math') math.push(token as MarkdownMathToken);
      if ('tokens' in token && token.tokens) walk(token.tokens);
      if (token.type === 'list') for (const item of token.items) walk(item.tokens);
      if (token.type === 'table') for (const cell of [...token.header, ...token.rows.flat()]) walk(cell.tokens);
    }
  };
  walk(markdownTokens(source)); return math;
}

test('reported boxed answer and all four TeX delimiters produce semantic math', () => {
  for (const [open, close, displayMode] of [['\\(', '\\)', false], ['$', '$', false], ['\\[', '\\]', true], ['$$', '$$', true]] as const) {
    const source = `答案是 ${open}\\boxed{21}${close} 个。`;
    const [token] = mathTokens(source); assert.ok(token); assert.equal(token.text, '\\boxed{21}'); assert.equal(token.displayMode, displayMode);
    const rendered = markdownMath(token); assert.equal(rendered.status, 'rendered');
    if (rendered.status === 'rendered') { assert.match(rendered.html, /class="katex"/); assert.match(rendered.html, /<math/); assert.match(rendered.html, /fbox/); }
    assert.equal(markdownBlocks(source).join(''), source);
  }
});

const formulas: Record<string, string> = {
  fractions: String.raw`\frac{a+b}{c} + \dfrac{1}{2} + \binom{n}{k}`,
  roots: String.raw`\sqrt{x^2+y^2}+\sqrt[3]{8}`,
  greek: String.raw`\alpha\beta\gamma\delta\theta\lambda\mu\pi\sigma\phi\omega\Gamma\Delta\Sigma\Omega`,
  calculus: String.raw`\sum_{i=1}^{n}i + \prod_{i=1}^{n}i + \int_0^\infty e^{-x}\,dx + \lim_{x\to0}\frac{\sin x}{x}`,
  sets: String.raw`\mathbb{R}\subseteq\mathbb{C},\quad A\cup B\cap C,\quad\forall x\exists y:x\in A\land y\notin B`,
  comparisons: String.raw`a\leq b\geq c\neq d\approx e\equiv f\sim g\propto h\pm i\times j\div k`,
  arrows: String.raw`A\to B\leftarrow C\leftrightarrow D\Rightarrow E\iff F\mapsto G`,
  accents: String.raw`\vec{x}+\hat{x}+\bar{x}+\overline{AB}+\dot{x}+\ddot{x}+\underbrace{x+y}_{z}`,
  matrix: String.raw`\begin{bmatrix}1&2\\3&4\end{bmatrix}\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
  cases: String.raw`f(x)=\begin{cases}x^2&x\ge0\\-x&x<0\end{cases}`,
  alignment: String.raw`\begin{aligned}a&=b+c\\d&=e-f\end{aligned}`,
  text: String.raw`\text{答案}\;\boxed{21}\;\mathrm{kg}\;\operatorname{rank}(A)`,
  escaping: String.raw`\{x\mid x>0\},\quad 50\%,\quad \$20,\quad\text{a\_b\&c}`,
  unicode: 'α + β ≤ ∞, x ∈ ℝ, ∑ ≠ ∫',
};
for (const [name, formula] of Object.entries(formulas)) test(`math symbol family: ${name}`, () => {
  const [token] = mathTokens(`\\[${formula}\\]`); assert.ok(token); assert.equal(token.text, formula);
  assert.equal(markdownMath(token).status, 'rendered');
});

test('display math and bare equation environments survive bilingual block pairing', () => {
  for (const body of ['\\[\nx=1\n\ny=2\n\\]', '$$\nx=1\n\ny=2\n$$', String.raw`\begin{align}x&=1\\y&=2\end{align}`, String.raw`\begin{equation}\boxed{21}\end{equation}`]) {
    const source = `Before\n\n${body}\n\nAfter`, blocks = markdownBlocks(source);
    assert.equal(blocks.join(''), source); assert.ok(blocks.some(block => block.includes(body)));
    assert.equal(mathTokens(source).length, 1); assert.equal(markdownMath(mathTokens(source)[0]!).status, 'rendered');
    assert.equal(blocks.flatMap(mathTokens).length, 1);
  }
});

test('math nests in emphasis, lists, quotes and tables without parsing its operators as Markdown', () => {
  const source = '# $a_1$\n\n**Result \\(\\boxed{21}\\)**\n\n- $x_i * y_j$\n- nested\n  - \\(a_b\\)\n\n> $x^2$\n\n| Name | Value |\n| --- | --- |\n| $n$ | $n_1$ |';
  assert.equal(mathTokens(source).length, 7);
  for (const token of mathTokens(source)) assert.equal(markdownMath(token).status, 'rendered');
});

test('emphasis boundaries ignore stars and underscores inside TeX', () => {
  for (const source of ['*before $a*b$ after*', '**before \\(a**b\\) after**', '_before $a_b$ after_']) {
    const [token] = mathTokens(source); assert.ok(token, source); assert.equal(markdownMath(token).status, 'rendered');
    const paragraph = markdownTokens(source)[0]; assert.equal(paragraph?.type, 'paragraph');
    if (paragraph?.type === 'paragraph') assert.equal(paragraph.tokens?.length, 1, source);
  }
});

test('currency, shell variables, code, paths, escaped delimiters and links stay literal', () => {
  for (const source of [
    'Costs $20 and $30. Budget $1,000; another $2,000.', 'Use $HOME or ${name}.', '$ not math $',
    '`\\(\\boxed{21}\\)` and `$x$`', '```latex\n\\[\\frac{1}{2}\\]\n```', '~~~math\n$x$\n~~~',
    '    \\(x\\)\n', String.raw`Literal \\(x\\) and \$x\$.`,
    '[a](https://example.invalid/$x$) and `C:\\folder\\file.txt`',
  ]) assert.equal(mathTokens(source).length, 0, source);
  const code = '  \\(\\boxed{21}\\) &alpha;\n\n  $a_b$';
  assert.equal(markdownCode(markdownTokens('```tex\n' + code + '\n```')[0]!), code);
});

test('all streamed prefixes stay safe and become rendered only after closing delimiters', () => {
  const source = String.raw`\(\boxed{21}\)`;
  for (let i = 2; i < source.length; i++) {
    const partial = source.slice(0, i), [token] = mathTokens(partial); assert.ok(token, partial);
    assert.equal(token.raw, partial); assert.equal(markdownMath(token).status, 'pending');
  }
  assert.equal(markdownMath(mathTokens(source)[0]!).status, 'rendered');
  const body = '\\[\nx=1\n\ny=2'; assert.deepEqual(markdownBlocks(body), [body]);
});

test('escaped dollars and TeX comments do not end equations early', () => {
  const source = '$x+\\$2$ and \\[x % \\] comment\n+y\\]';
  const tokens = mathTokens(source); assert.equal(tokens.length, 2);
  assert.equal(tokens[0]!.text, 'x+\\$2'); assert.equal(tokens[1]!.text, 'x % \\] comment\n+y');
});

test('invalid commands, input limits and recursive macros fail locally without polluting later messages', () => {
  for (const text of [String.raw`\unknowncommand{21}`, String.raw`\def\a{\a}\a`, String.raw`\frac{1}{2`]) {
    const token = mathTokens(`\\(${text}\\)`)[0]!;
    assert.deepEqual(markdownMath(token), { status: 'invalid', raw: token.raw, error: 'MATH_INVALID_OR_UNSUPPORTED' });
  }
  assert.equal(markdownMath({ raw: 'raw', text: 'x'.repeat(16_385), displayMode: false, complete: true }).status, 'limit');
  markdownMath(mathTokens(String.raw`\(\gdef\saved{21}\saved\)`)[0]!);
  assert.equal(markdownMath(mathTokens(String.raw`\(\saved\)`)[0]!).status, 'invalid');
  assert.equal(markdownMath(mathTokens(String.raw`\(\boxed{21}\)`)[0]!).status, 'rendered');
});

test('model math cannot create links, image requests, arbitrary HTML or event handlers', () => {
  for (const text of [String.raw`\href{javascript:alert(1)}{x}`, String.raw`\href{https://example.invalid}{x}`, String.raw`\includegraphics{https://example.invalid/tracker}`, String.raw`\htmlStyle{position:fixed}{x}`, String.raw`\text{<img src=x onerror=alert(1)>}`]) {
    const result = markdownMath(mathTokens(`\\(${text}\\)`)[0]!);
    if (result.status === 'rendered') assert.doesNotMatch(result.html, /<(?:a|img|script|iframe)\b|style="position:fixed|\sonerror="/);
  }
});

test('HTML5 named and numeric symbols decode once, with Unicode and invalid entities preserved correctly', () => {
  assert.equal(markdownText('&alpha; &Omega; &le; &ge; &ne; &times; &rarr; &infin; &copy; &mdash;'), 'α Ω ≤ ≥ ≠ × → ∞ © —');
  assert.equal(markdownText('&NotEqualTilde; &#x1F600; &#945; &#0; &#xD800;'), '≂̸ 😀 α � �');
  assert.equal(markdownText('&amp;alpha; &madeup; &alpha αβ ≤≥ 😀'), '&alpha; &madeup; &alpha αβ ≤≥ 😀');
});

test('renderer plugin Markdown facade invokes the same pure display implementation', () => {
  assert.equal(markdownApi.tokens, markdownTokens); assert.equal(markdownApi.math, markdownMath);
  assert.equal(markdownApi.text('&sum;'), '∑'); assert.ok(Object.isFrozen(markdownApi));
  const source = String.raw`\[\boxed{21}\]`, token = markdownApi.tokens(source)[0] as MarkdownMathToken;
  assert.equal(markdownApi.math(token).status, 'rendered'); assert.deepEqual(markdownApi.blocks(source), [source]);
});
