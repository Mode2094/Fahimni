import raw from '../../data/textbook.json';

// Legacy bundled textbook chunks and subject-scoped PostgreSQL chunks share this
// shape so the BM25 logic below is identical for both.
export type RetrievalChunk = {
  id: string;
  sourceId: string;
  pdfPage: number;
  printedPage: number | null;
  unit: string | null;
  lesson: string | null;
  heading?: string | null;
  text: string;
  equations: string[];
  image: string;
  bookId?: string | null;
  [key: string]: unknown;
};

export type ScoredChunk = RetrievalChunk & { score: number; matched: number };
export type Retriever = (question: string, limit?: number) => ScoredChunk[];

export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u0640\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .toLowerCase();
}

const stop = new Set(['في','من','علي','الي','هو','هي','ما','كيف','اشرح','اشرحلي','لي','انا','هذا','هذه','حل','الدرس','اريد','بدي','ممكن','السؤال','اعطيني','ماهو']);

export function tokens(s: string): string[] {
  return normalize(s)
    .split(/[^\p{L}\p{N}_^=+-]+/u)
    .map((w) => w.replace(/^ال/, ''))
    .filter((w) => w.length > 1 && !stop.has(w));
}

const synonyms: [RegExp, string][] = [[/دايره|دائرة|دائره|دائري/,'الدائرة الاقواس القطر نصف قطر'],[/مماس|اوتار|وتر /,'أوتار الدائرة وأقطارها ومماساتها'],[/جيب تمام|جيوب تمام|cosine|cos\b/,'جيوب التمام النسب المثلثية'],[/قانون.*جيب(?!.*تمام)|sine rule/,'قانون الجيوب'],[/sin\b|جيب |جا\b/,'النسب المثلثية جيب الزاوية'],[/مساح.*مثلث/,'استعمال جيب الزاوية لإيجاد مساحة المثلث'],[/شمال|bearing/,'الاتجاه من الشمال'],[/تكعيب|تكعيبيه|x\s*\^\s*[34]|عامل مشترك/,'حل معادلات خاصة التحليل'],[/نظام|معادلتين/,'نظام معادلة خطية تربيعية'],[/معادل|طرفين|اطرح|طرح|قسمة/,'المعادلات'],[/منحني|منحنى|رسم.*(جيب|مثلث)|دوري/,'تمثيل الاقترانات المثلثية']];

// True when two terms differ by at most one insertion, deletion or substitution.
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  if (i < a.length || j < b.length) edits += 1;
  return edits <= 1;
}

// Builds a self-contained BM25-style retriever over any chunk set; the legacy
// static textbook and subject books use the exact same ranking.
export function buildRetriever(chunks: readonly RetrievalChunk[]): Retriever {
  const docs = chunks.map((c) => ({ c, terms: tokens(c.text), title: tokens(`${c.lesson ?? ''} ${c.unit ?? ''}`) }));
  const df = new Map<string, number>();
  docs.forEach((d) => new Set(d.terms).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  const avg = docs.length ? docs.reduce((n, d) => n + d.terms.length, 0) / docs.length : 1;

  return (question: string, limit = 5): ScoredChunk[] => {
    if (!docs.length) return [];
    const original = normalize(question);
    const explicit = original.match(/(?:صفحه|page)\s*(\d{1,3})/);
    if (explicit) {
      const page = Number(explicit[1]);
      const hit = chunks.find((c) => c.pdfPage === page);
      if (hit) {
        return [hit, ...chunks.filter((c) => c.lesson === hit.lesson && c.pdfPage !== page).sort((a, b) => Math.abs(a.pdfPage - page) - Math.abs(b.pdfPage - page)).slice(0, limit - 1)].map((c) => ({ ...c, score: 100, matched: 1 }));
      }
    }
    let q = original;
    if (/[=]/.test(q) && !/[\u0600-\u06ff]/.test(q)) q += ' المعادلات';
    const originalTerms = new Set(tokens(q));
    for (const [re, extra] of synonyms) if (re.test(q)) q += ' ' + normalize(extra);
    const terms = [...new Set(tokens(q))];
    if (!terms.length) return [];

    // Bounded tolerant expansion: a query term the book never spells exactly
    // (misspelling, suffix or prefix variation) is matched against vocabulary
    // terms sharing a four-character prefix or one edit, at a reduced weight.
    // Capped so a short query can never fan out into a broad search.
    const weights = new Map<string, number>();
    for (const term of terms) weights.set(term, originalTerms.has(term) ? 1 : 0.3);
    let expansions = 0;
    for (const term of terms) {
      if (expansions >= 6 || term.length < 4) continue;
      for (const candidate of df.keys()) {
        if (weights.has(candidate) || candidate.length < 4) continue;
        if (Math.abs(candidate.length - term.length) > 1) continue;
        if (candidate[0] !== term[0]) continue;
        const prefix = candidate.slice(0, 4) === term.slice(0, 4);
        if (!prefix && !withinOneEdit(term, candidate)) continue;
        weights.set(candidate, prefix ? 0.45 : 0.35);
        expansions += 1;
        if (expansions >= 6) break;
      }
    }

    const ranked = docs
      .map((d) => {
        let score = d.c.lesson && original.includes(normalize(d.c.lesson)) ? 25 : 0;
        let matched = 0;
        for (const [t, weight] of weights) {
          const tf = d.terms.filter((w) => w === t).length;
          const title = d.title.includes(t);
          if (tf || title) matched++;
          if (tf) score += weight * Math.log(1 + (docs.length - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5)) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * d.terms.length / avg));
          if (title) score += 6 * weight;
        }
        return { ...d.c, score, matched };
      })
      // Short questions deserve a lower bar: a single strong term is a valid
      // signal, while long questions keep the stricter threshold.
      .filter((c) => c.score >= (terms.length === 1 ? 1.2 : 3) && c.matched >= Math.min(2, terms.length))
      .sort((a, b) => b.score - a.score);
    // Keep primary lesson coherent; spare one slot for an alternate match.
    const primary = ranked[0]?.lesson;
    return [...ranked.filter((x) => x.lesson === primary).slice(0, limit - 1), ...ranked.filter((x) => x.lesson !== primary).slice(0, 1)].sort((a, b) => b.score - a.score).slice(0, limit);
  };
}

export const chunks: RetrievalChunk[] = raw as unknown as RetrievalChunk[];
export type Chunk = RetrievalChunk;

// Legacy bundled textbook retriever, used by the original classroom route.
export const retrieve: Retriever = buildRetriever(chunks);

export function sourceFor(c: RetrievalChunk) {
  return {
    chunkId: c.id,
    sourceId: c.sourceId,
    pdfPage: c.pdfPage,
    printedPage: c.printedPage,
    lesson: c.lesson ?? '',
    image: c.image,
    bookId: c.bookId ?? null,
  };
}
