import type {Action} from '../../schemas/lesson';

// Deterministic, schema-valid visual compositions built from the board
// primitives. The AI teacher composes the same primitives itself; these
// presets exist for fixtures, renderer tests and future prompt tooling.
// Every coordinate lives in the lesson schema's [-10,10] graph space.

type PartialAction = Partial<Action> & { type: Action['type'] };

const a = (partial: PartialAction): Action => ({
  id: null,
  content: null,
  region: 'working-area',
  targets: [],
  points: [],
  color: 'ink',
  geometry: null,
  delayMs: 0,
  ...partial,
});

export function triangleWithAltitude(): Action[] {
  const vertices = [
    { x: -6, y: -4 },
    { x: 6, y: -4 },
    { x: 1, y: 5 },
  ];
  return [
    a({ type: 'draw_axes', id: 'geo-axes', region: 'graph-area', color: 'blue' }),
    a({ type: 'plot_points', id: 'geo-triangle', region: 'graph-area', color: 'ink', points: [...vertices, vertices[0]] }),
    a({ type: 'plot_point', id: 'geo-a', region: 'graph-area', color: 'amber', points: [vertices[0]] }),
    a({ type: 'plot_point', id: 'geo-b', region: 'graph-area', color: 'amber', points: [vertices[1]] }),
    a({ type: 'plot_point', id: 'geo-c', region: 'graph-area', color: 'amber', points: [vertices[2]] }),
    a({ type: 'plot_points', id: 'geo-altitude', region: 'graph-area', color: 'red', points: [{ x: 1, y: -4 }, vertices[2]] }),
    a({ type: 'show_label', id: 'geo-label-a', region: 'explanation-area', content: 'أ' }),
    a({ type: 'show_label', id: 'geo-label-b', region: 'explanation-area', content: 'ب' }),
    a({ type: 'show_label', id: 'geo-label-c', region: 'explanation-area', content: 'ج' }),
    a({ type: 'show_label', id: 'geo-label-h', region: 'explanation-area', content: 'الارتفاع هـ' }),
    a({ type: 'write_latex', id: 'geo-area', region: 'working-area', content: 'A = \\frac{1}{2} \\times b \\times h' }),
  ];
}

export function forceVectorDiagram(): Action[] {
  return [
    a({ type: 'draw_axes', id: 'vec-axes', region: 'graph-area', color: 'blue' }),
    a({ type: 'draw_arrow', id: 'vec-f1', region: 'graph-area', color: 'red', points: [{ x: 0, y: 0 }, { x: 6, y: 0 }] }),
    a({ type: 'draw_arrow', id: 'vec-f2', region: 'graph-area', color: 'teal', points: [{ x: 0, y: 0 }, { x: 0, y: 6 }] }),
    a({ type: 'draw_arrow', id: 'vec-result', region: 'graph-area', color: 'amber', points: [{ x: 0, y: 0 }, { x: 6, y: 6 }] }),
    a({ type: 'show_label', id: 'vec-label-f1', region: 'explanation-area', content: 'القوة الأولى 6 نيوتن شرقًا' }),
    a({ type: 'show_label', id: 'vec-label-f2', region: 'explanation-area', content: 'القوة الثانية 6 نيوتن شمالًا' }),
    a({ type: 'write_latex', id: 'vec-result-value', region: 'result-area', content: 'F = \\sqrt{6^2 + 6^2} \\approx 8.49\\ \\text{N}' }),
  ];
}

export function timeline(): Action[] {
  return [
    a({ type: 'draw_line', id: 'time-axis', region: 'graph-area', color: 'blue', points: [{ x: -8, y: 0 }, { x: 8, y: 0 }] }),
    a({ type: 'plot_point', id: 'time-p1', region: 'graph-area', color: 'amber', points: [{ x: -6, y: 0 }] }),
    a({ type: 'plot_point', id: 'time-p2', region: 'graph-area', color: 'amber', points: [{ x: 0, y: 0 }] }),
    a({ type: 'plot_point', id: 'time-p3', region: 'graph-area', color: 'amber', points: [{ x: 6, y: 0 }] }),
    a({ type: 'show_label', id: 'time-l1', region: 'explanation-area', content: 'الحدث الأول' }),
    a({ type: 'show_label', id: 'time-l2', region: 'explanation-area', content: 'الحدث الثاني' }),
    a({ type: 'show_label', id: 'time-l3', region: 'explanation-area', content: 'الحدث الثالث' }),
  ];
}

export function arabicSentenceAnalysis(): Action[] {
  const words: { id: string; word: string; color: Action['color'] }[] = [
    { id: 'ar-w1', word: 'الطالبُ', color: 'blue' },
    { id: 'ar-w2', word: 'المجتهدُ', color: 'teal' },
    { id: 'ar-w3', word: 'ينجحُ', color: 'red' },
  ];
  return [
    ...words.map((entry) => a({ type: 'write_text', id: entry.id, region: 'working-area', color: entry.color, content: entry.word })),
    a({ type: 'show_label', id: 'ar-role-1', region: 'explanation-area', content: 'الطالبُ: مبتدأ مرفوع' }),
    a({ type: 'show_label', id: 'ar-role-2', region: 'explanation-area', content: 'المجتهدُ: صفة مرفوعة' }),
    a({ type: 'show_label', id: 'ar-role-3', region: 'explanation-area', content: 'ينجحُ: فعل مضارع مرفوع' }),
  ];
}

export function waterMoleculeDiagram(): Action[] {
  return [
    a({ type: 'plot_point', id: 'mol-o', region: 'graph-area', color: 'red', points: [{ x: 0, y: 0 }] }),
    a({ type: 'plot_point', id: 'mol-h1', region: 'graph-area', color: 'blue', points: [{ x: -5, y: 3 }] }),
    a({ type: 'plot_point', id: 'mol-h2', region: 'graph-area', color: 'blue', points: [{ x: 5, y: 3 }] }),
    a({ type: 'draw_line', id: 'mol-bond-1', region: 'graph-area', color: 'ink', points: [{ x: 0, y: 0 }, { x: -5, y: 3 }] }),
    a({ type: 'draw_line', id: 'mol-bond-2', region: 'graph-area', color: 'ink', points: [{ x: 0, y: 0 }, { x: 5, y: 3 }] }),
    a({ type: 'show_label', id: 'mol-label-o', region: 'explanation-area', content: 'ذرة أكسجين O' }),
    a({ type: 'show_label', id: 'mol-label-h', region: 'explanation-area', content: 'ذرتا هيدروجين H' }),
    a({ type: 'write_latex', id: 'mol-formula', region: 'result-area', content: 'H_2O' }),
  ];
}

export const SUBJECT_PRESETS = {
  geometry: triangleWithAltitude,
  physics: forceVectorDiagram,
  history: timeline,
  arabic: arabicSentenceAnalysis,
  chemistry: waterMoleculeDiagram,
} as const;

export type SubjectPresetKey = keyof typeof SUBJECT_PRESETS;
