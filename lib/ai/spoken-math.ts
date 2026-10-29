// Deterministic LaTeX → spoken Arabic normalization for teacher narration.
// The board keeps real KaTeX (write_latex is untouched); only the spoken and
// displayed narration text is normalized so TTS never receives raw LaTeX.

const LETTERS: Record<string, string> = {
  x: 'إكس', y: 'واي', z: 'زد', a: 'أ', b: 'ب', c: 'ج', d: 'دال', e: 'هـ',
  f: 'إف', g: 'جي', h: 'إتش', i: 'آي', j: 'جاي', k: 'كاف', l: 'إل', m: 'ميم',
  n: 'نون', o: 'أو', p: 'بي', q: 'كيو', r: 'راء', s: 'إس', t: 'تي', u: 'يو',
  v: 'في', w: 'دبليو',
};

const GREEK: Record<string, string> = {
  alpha: 'ألفا', beta: 'بيتا', gamma: 'غاما', delta: 'دلتا', theta: 'ثيتا', pi: 'باي',
  lambda: 'لامدا', mu: 'ميو', sigma: 'سيغما', phi: 'فاي', omega: 'أوميغا', Delta: 'دلتا الكبيرة',
};

const SUBSCRIPTS: Record<string, string> = {
  '0': 'صفر', '1': 'واحد', '2': 'اثنين', '3': 'ثلاثة', '4': 'أربعة',
  '5': 'خمسة', '6': 'ستة', '7': 'سبعة', '8': 'ثمانية', '9': 'تسعة',
};

// Reads a {...} group starting at the opening brace; returns null when the
// braces are unbalanced (the caller then falls back to plain cleanup).
function readGroup(text: string, start: number): { body: string; end: number } | null {
  if (text[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: text.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

function speakPower(exponent: string): string {
  const value = exponent.trim().replace(/[{}]/g, '');
  if (value === '2') return 'تربيع';
  if (value === '3') return 'تكعيب';
  if (value === '') return '';
  return `أس ${value}`;
}

function speakSubscript(value: string): string {
  const clean = value.trim().replace(/[{}]/g, '');
  if (!clean) return '';
  return SUBSCRIPTS[clean] ?? clean;
}

// Structures first (fractions, roots, text wrappers), then symbols, then
// variables, then a final guard that strips any residual command syntax.
export function toSpokenArabic(input: string): string {
  let text = String(input ?? '');
  if (!text.trim()) return '';

  // \text{...} and friends keep their content.
  for (const command of ['\\text', '\\mathrm', '\\operatorname', '\\mbox']) {
    let index = text.indexOf(command);
    while (index !== -1) {
      const group = readGroup(text, index + command.length);
      if (!group) break;
      text = text.slice(0, index) + group.body + text.slice(group.end);
      index = text.indexOf(command, index);
    }
  }

  // \sqrt[n]{x} and \sqrt{x}
  let guard = 0;
  while (guard < 40) {
    const index = text.indexOf('\\sqrt');
    if (index === -1) break;
    guard += 1;
    let cursor = index + '\\sqrt'.length;
    let degree = '';
    if (text[cursor] === '[') {
      const close = text.indexOf(']', cursor);
      if (close !== -1) {
        degree = text.slice(cursor + 1, close);
        cursor = close + 1;
      }
    }
    const group = readGroup(text, cursor);
    if (!group) {
      text = text.slice(0, index) + 'جذر' + text.slice(index + '\\sqrt'.length);
      continue;
    }
    const spoken = degree.trim() ? `الجذر ${speakSubscript(degree)} لـ ${group.body}` : `جذر ${group.body}`;
    text = text.slice(0, index) + spoken + text.slice(group.end);
  }

  // \frac{a}{b}
  guard = 0;
  while (guard < 40) {
    const index = text.indexOf('\\frac');
    if (index === -1) break;
    guard += 1;
    const numerator = readGroup(text, index + '\\frac'.length);
    const denominator = numerator ? readGroup(text, numerator.end) : null;
    if (!numerator || !denominator) {
      text = text.slice(0, index) + text.slice(index + '\\frac'.length);
      continue;
    }
    text = text.slice(0, index) + `${numerator.body} على ${denominator.body}` + text.slice(denominator.end);
  }

  // Powers and subscripts, with or without braces.
  text = text.replace(/\^\{([^{}]*)\}/g, (_, exponent: string) => ` ${speakPower(exponent)}`);
  text = text.replace(/\^([0-9a-zA-Z])/g, (_, exponent: string) => ` ${speakPower(exponent)}`);
  text = text.replace(/_\{([^{}]*)\}/g, (_, value: string) => ` ${speakSubscript(value)}`);
  text = text.replace(/_([0-9a-zA-Z])/g, (_, value: string) => ` ${speakSubscript(value)}`);

  // Greek letters and named symbols.
  for (const [name, spoken] of Object.entries(GREEK)) {
    text = text.replace(new RegExp(`\\\\${name}\\b`, 'g'), ` ${spoken} `);
  }
  // Named functions become Arabic words instead of disappearing with the
  // generic command cleanup.
  text = text
    .replace(/\\sin(?![a-zA-Z])/g, ' جيب ')
    .replace(/\\cos(?![a-zA-Z])/g, ' جيب تمام ')
    .replace(/\\tan(?![a-zA-Z])/g, ' ظل ')
    .replace(/\\log(?![a-zA-Z])/g, ' لوغاريتم ')
    .replace(/\\ln(?![a-zA-Z])/g, ' لوغاريتم طبيعي ');

  // Operators and relations.
  text = text
    .replace(/\\times|\\cdot|×|⋅|\*/g, ' ضرب ')
    .replace(/\\div|÷/g, ' على ')
    .replace(/\\pm|±/g, ' زائد أو ناقص ')
    .replace(/\\mp|∓/g, ' ناقص أو زائد ')
    .replace(/\\neq|\\ne(?![a-zA-Z])|≠/g, ' لا يساوي ')
    .replace(/\\leq|\\le(?![a-zA-Z])|≤/g, ' أصغر من أو يساوي ')
    .replace(/\\geq|\\ge(?![a-zA-Z])|≥/g, ' أكبر من أو يساوي ')
    .replace(/\\approx|≈/g, ' تقريبًا يساوي ')
    .replace(/\\infty|∞/g, ' ما لا نهاية ')
    .replace(/\\in(?![a-zA-Z])|∈/g, ' ينتمي إلى ')
    .replace(/\\ldots|\\dots|…/g, ' وهكذا ')
    .replace(/\\quad|\\qquad|\\;|\\,|\\!|\\:/g, ' ')
    .replace(/\\left|\\right|\\big|\\Big|\\bigg|\\Bigg/g, ' ');

  // Final guard: no command syntax, no math delimiters, no stray braces.
  text = text
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[${}]/g, ' ')
    .replace(/\^/g, ' ')
    .replace(/(?<=\s)_(?=\s)/g, ' ');

  // Relations and signs become words; keep digits as they are (Arabic TTS
  // reads Western digits naturally).
  text = text
    .replace(/=/g, ' يساوي ')
    .replace(/\+/g, ' زائد ')
    .replace(/[−–]|(?<=\s)-(?=\s|\d)|^-(?=\d)/g, ' ناقص ');

  // Standalone Latin variables (single letters or runs like xy, 3x) are spoken
  // as Arabic letter names.
  text = text.replace(/(?<![\p{L}])([a-zA-Z]+)(?![\p{L}])/gu, (match) =>
    ` ${match
      .split('')
      .map((letter) => LETTERS[letter.toLowerCase()] ?? letter)
      .join(' ')} `,
  );

  return text.replace(/\s{2,}/g, ' ').trim();
}
