// Bounded, deterministic math verification. No arbitrary code execution: the
// evaluator is a hand-written recursive-descent parser over a fixed grammar
// (numbers, + - * / ^, parentheses, unary minus, √, π, ×÷−), length-limited.

export type Verdict = 'correct' | 'incorrect' | 'unknown';
export type AnswerCheck = { verdict: Verdict; reason: string };

const MAX_EXPRESSION_LENGTH = 160;
const EPSILON = 5e-5;

function normalizeText(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[−–—]/g, '-')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------ evaluator -- */

type Token = { kind: 'number'; value: number } | { kind: 'op'; value: string };

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === ' ') {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let number = '';
      while (index < input.length && /[0-9.]/.test(input[index])) number += input[index++];
      const value = Number.parseFloat(number);
      if (!Number.isFinite(value)) return null;
      tokens.push({ kind: 'number', value });
      continue;
    }
    if (input.startsWith('pi', index)) {
      tokens.push({ kind: 'number', value: Math.PI });
      index += 2;
      continue;
    }
    if (input.startsWith('sqrt', index)) {
      tokens.push({ kind: 'op', value: 'sqrt' });
      index += 4;
      continue;
    }
    if ('+-*/^()'.includes(char)) {
      tokens.push({ kind: 'op', value: char });
      index += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

// Recursive descent: expression → term (±) → factor (×÷) → power (^) → unary → atom.
function evaluateTokens(tokens: Token[]): number | null {
  let position = 0;
  const peek = () => tokens[position];
  const parseExpression = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    while (peek()?.value === '+' || peek()?.value === '-') {
      const op = tokens[position++].value;
      const right = parseTerm();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = (): number | null => {
    let left = parsePower();
    if (left === null) return null;
    while (peek()?.value === '*' || peek()?.value === '/') {
      const op = tokens[position++].value;
      const right = parsePower();
      if (right === null) return null;
      if (op === '/') {
        if (Math.abs(right) < Number.EPSILON) return null;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  };
  const parsePower = (): number | null => {
    const base = parseUnary();
    if (base === null) return null;
    if (peek()?.value === '^') {
      position += 1;
      const exponent = parsePower();
      if (exponent === null) return null;
      const value = Math.pow(base, exponent);
      return Number.isFinite(value) ? value : null;
    }
    return base;
  };
  const parseUnary = (): number | null => {
    if (peek()?.value === '-') {
      position += 1;
      const value = parseUnary();
      return value === null ? null : -value;
    }
    if (peek()?.value === '+') {
      position += 1;
      return parseUnary();
    }
    if (peek()?.value === 'sqrt') {
      position += 1;
      const value = parseUnary();
      if (value === null || value < 0) return null;
      return Math.sqrt(value);
    }
    return parseAtom();
  };
  const parseAtom = (): number | null => {
    const token = peek();
    if (!token) return null;
    if (token.kind === 'number') {
      position += 1;
      return token.value;
    }
    if (token.value === '(') {
      position += 1;
      const value = parseExpression();
      if (value === null) return null;
      if (peek()?.value !== ')') return null;
      position += 1;
      return value;
    }
    return null;
  };
  const result = parseExpression();
  if (result === null || position !== tokens.length) return null;
  return result;
}

// Safe numeric evaluation of a self-contained arithmetic expression.
export function evaluateNumeric(expression: string): number | null {
  const normalized = normalizeText(expression);
  if (!normalized || normalized.length > MAX_EXPRESSION_LENGTH) return null;
  const tokens = tokenize(normalized);
  if (!tokens || !tokens.length) return null;
  const value = evaluateTokens(tokens);
  if (value === null || !Number.isFinite(value)) return null;
  return value;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

/* -------------------------------------------------------------- parsing -- */

export type Quadratic = { a: number; b: number; c: number };

function signedValue(raw: string | undefined, sign: string | undefined): number {
  if (!raw) return 1;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return Number.NaN;
  return sign && /ناقص|^-/.test(sign) ? -value : value;
}

// ax² + bx + c in Arabic prose or LaTeX (a defaults to 1).
export function parseQuadratic(text: string): Quadratic | null {
  const clean = normalizeText(text);
  const arabic = clean.match(/(?:^|[^\d])(\d+)?\s*(?:س|إكس|x)\s*(?:تربيع|أس\s*2|\^2)([\s\S]*)$/);
  const latex = clean.match(/(\d+)?\s*[xX]\^?2([\s\S]*)$/);
  const match = arabic ?? latex;
  if (!match) return null;
  const a = match[1] ? Number.parseInt(match[1], 10) : 1;
  const tail = match[2] ?? '';
  const bMatch = tail.match(/(ناقص|زائد|[+-])\s*(\d+)\s*(?:س|إكس|x)/);
  const b = bMatch ? signedValue(bMatch[2], bMatch[1]) : 0;
  const cMatch = tail.match(/(ناقص|زائد|[+-])\s*(\d+)(?!\s*(?:س|إكس|x))/);
  const c = cMatch ? signedValue(cMatch[2], cMatch[1]) : 0;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || a === 0) return null;
  return { a, b, c };
}

// Factor pairs (x ± p)(x ± q); leading coefficient must be 1 for now.
export function parseFactors(text: string): { p: number; q: number } | null {
  const clean = normalizeText(text);
  const match = clean.match(/\(\s*(?:س|إكس|x)\s*(ناقص|زائد|[+-])?\s*(\d+)?\s*\)\s*\(\s*(?:س|إكس|x)\s*(ناقص|زائد|[+-])?\s*(\d+)?\s*\)/);
  if (!match) return null;
  const p = match[2] ? signedValue(match[2], match[1]) : 0;
  const q = match[4] ? signedValue(match[4], match[3]) : 0;
  if (!Number.isFinite(p) || !Number.isFinite(q)) return null;
  return { p, q };
}

// A list of candidate solution values from free text: «س = 2 أو س = -2»،
// «(س-2)(س-3)»، «±√2»، «1/2». When the attempt is written as an equation the
// values after the equals sign are read directly; otherwise the text is read as
// a factor form, where «(س-2)» contributes the root +2 (the sign flips).
export function parseSolutions(text: string): number[] | null {
  const clean = normalizeText(text);
  const equals = clean.lastIndexOf('=');
  const equationForm = equals >= 0;
  // Equation form may list several values («س = 2 أو س = 3»): read the value
  // after every equals sign, not only the last one.
  const source = equationForm
    ? clean
        .split(/أو|\sو\s/)
        .map((part) => {
          const index = part.lastIndexOf('=');
          return index >= 0 ? part.slice(index + 1) : part;
        })
        .join(' ')
        .replace(/(?:س|إكس|x)\s*=/g, ' ')
    : clean;
  const values: number[] = [];
  const pattern = /(±|ناقص|زائد|[+-])?\s*(sqrt\s*\(?\s*\d+(?:\.\d+)?\s*\)?|\(?\s*\d+(?:\.\d+)?\s*(?:\/\s*\d+(?:\.\d+)?)?\s*\)?)/g;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = pattern.exec(source))) {
    if (!match[2]) continue;
    const sign = match[1];
    const body = match[2].replace(/[()]/g, '').trim();
    // In factor form a sign immediately before the constant flips the root.
    const before = source.slice(0, match.index).trimEnd();
    const factorSign = !equationForm && /(?:س|إكس|x)$/.test(before);
    const value = evaluateNumeric(body);
    if (value === null) continue;
    consumed += 1;
    if (sign === '±') {
      values.push(value, -value);
    } else if (sign && /ناقص|^-/.test(sign)) {
      values.push(factorSign ? value : -value);
    } else {
      values.push(factorSign ? -value : value);
    }
  }
  if (!consumed) return null;
  // Deduplicate near-identical values while preserving order.
  const unique: number[] = [];
  for (const value of values) if (!unique.some((existing) => close(existing, value))) unique.push(value);
  return unique;
}

export function expandFactors({ p, q }: { p: number; q: number }): Quadratic {
  return { a: 1, b: p + q, c: p * q };
}

/* ----------------------------------------------------------- verification -- */

export function verifySimpleFactors(problemText: string, attemptText: string): boolean | null {
  const problem = parseQuadratic(problemText);
  const attempt = parseFactors(attemptText);
  if (!problem || !attempt || problem.a !== 1) return null;
  const expanded = expandFactors(attempt);
  return close(expanded.b, problem.b) && close(expanded.c, problem.c);
}

function quadraticRoots({ a, b, c }: Quadratic): number[] | null {
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
}

function sameSolutionSet(expected: number[], given: number[]): boolean {
  if (expected.length !== given.length) return false;
  const used = new Set<number>();
  for (const value of expected) {
    const index = given.findIndex((candidate, position) => !used.has(position) && close(candidate, value));
    if (index === -1) return false;
    used.add(index);
  }
  return true;
}

// The single entry point used by evaluation: correct / incorrect / unknown.
// "unknown" means the answer could not be reliably verified — never grade it.
export function verifyAnswer(problemText: string, attemptText: string): AnswerCheck {
  const problem = normalizeText(problemText);
  const attempt = normalizeText(attemptText);

  // 1) Factorable quadratic: (x±p)(x±q) vs x²+bx+c
  const factored = verifySimpleFactors(problem, attempt);
  if (factored !== null) {
    return factored ? { verdict: 'correct', reason: 'التحليل مطابق بالمعاملات' } : { verdict: 'incorrect', reason: 'الحد الأوسط أو الحد الثابت لا يطابق المعادلة الأصلية' };
  }

  // 2) Solution set vs quadratic roots
  const quadratic = parseQuadratic(problem);
  if (quadratic) {
    const roots = quadraticRoots(quadratic);
    const given = parseSolutions(attempt);
    if (roots && given && given.length) {
      if (sameSolutionSet(roots, given)) return { verdict: 'correct', reason: 'مجموعة الحلول مطابقة' };
      const someMatch = given.some((value) => roots.some((root) => close(root, value)));
      return someMatch
        ? { verdict: 'incorrect', reason: 'إحدى القيم صحيحة لكن المجموعة غير مكتملة أو فيها قيمة خاطئة' }
        : { verdict: 'incorrect', reason: 'القيم لا تحقق المعادلة' };
    }
  }

  // 3) Linear equation ax + b = c  →  x = (c − b) / a  (b may be absent)
  const linear = problem.match(/([+-]?\s*\d*\.?\d*)\s*(?:س|إكس|x)\s*(?:(ناقص|زائد|[+-])\s*(\d+(?:\.\d+)?))?\s*(?:=|يساوي)\s*(ناقص|زائد|[+-])?\s*(\d+(?:\.\d+)?)/);
  if (linear) {
    const a = linear[1] && linear[1].trim() ? signedValue(linear[1].replace(/\s+/g, ''), undefined) : 1;
    const b = linear[3] ? signedValue(linear[3], linear[2]) : 0;
    const c = signedValue(linear[5], linear[4]);
    if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && a !== 0) {
      const expected = (c - b) / a;
      const given = parseSolutions(attempt);
      if (given && given.length) {
        return given.length === 1 && close(given[0], expected)
          ? { verdict: 'correct', reason: 'الحل يحقق المعادلة' }
          : { verdict: 'incorrect', reason: 'القيمة لا تحقق المعادلة الأصلية' };
      }
    }
  }

  // 4) Pure arithmetic equality: 2+3 vs 5 (Arabic words are stripped before the
  // variable check so «يساوي» is never mistaken for the variable س).
  const problemLatin = problem.replace(/[\u0600-\u06ff]+/g, ' ');
  const attemptLatin = attempt.replace(/[\u0600-\u06ff]+/g, ' ');
  if (!/[xy]/.test(problemLatin) && !/[xy]/.test(attemptLatin)) {
    const problemValue = evaluateNumeric(problemLatin.replace(/=.*$/, ''));
    const attemptValue = evaluateNumeric(attemptLatin);
    if (problemValue !== null && attemptValue !== null) {
      return close(problemValue, attemptValue)
        ? { verdict: 'correct', reason: 'الناتج مطابق' }
        : { verdict: 'incorrect', reason: 'الناتج غير مطابق' };
    }
  }

  return { verdict: 'unknown', reason: 'تعذر التحقق رياضيًا من هذه الصيغة' };
}
