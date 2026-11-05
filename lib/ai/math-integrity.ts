import katex from 'katex';

/** Validate without guessing what a damaged expression was meant to say. */
export function assertTextIntegrity(text: string): void {
  if (/\p{Surrogate}/u.test(text) || /\uFFFD|â[€™œ€š€¦]|Î.|Ï.|Ã.|Â./u.test(text)) {
    throw new Error('Text encoding is damaged; regenerate from the source in UTF-8');
  }
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if ((code < 32 && code !== 10) || code === 127) {
      throw new Error(`Unexpected control U+${code.toString(16).padStart(4, '0')} (check JSON backslash escaping)`);
    }
  }
}

export function assertMathIntegrity(expression: string): void {
  assertTextIntegrity(expression);
  if (!expression.trim()) throw new Error('Empty mathematical expression');
  if (/\p{Cf}/u.test(expression)) throw new Error('Invisible formatting controls inside mathematics; use canonical notation and external direction isolation');
  for(const character of expression){
    if(!/[\p{Script=Latin}\p{Script=Greek}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Common}\p{Script=Inherited}]/u.test(character))throw new Error(`Unexpected Unicode script in mathematics: U+${character.codePointAt(0)!.toString(16)}; regenerate canonical notation`);
  }
  katex.renderToString(expression, {
    throwOnError: true, trust: false, strict: 'ignore',
    displayMode: true, maxSize: 10, maxExpand: 500,
  });
}
