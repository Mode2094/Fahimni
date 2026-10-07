import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodType } from 'zod';

type Json = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const unescapePointer = (token: string) =>
  decodeURIComponent(token).replace(/~1/g, '/').replace(/~0/g, '~');

// OpenAI Structured Outputs only accepts $ref targets that live at the top
// level of the schema. zodToJsonSchema points refs at deep paths inside the
// document (e.g. #/properties/segments/items/properties/id), which the API
// rejects with 400 "reference can only point to definitions defined at the top
// level". Resolve every ref against the generated document and inline it.
const inlineRefs = (node: unknown, root: Json, seen: Set<string>): unknown => {
  if (Array.isArray(node)) return node.map(n => inlineRefs(n, root, seen));
  if (!isPlainObject(node)) return node;
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    if (seen.has(node.$ref)) return {}; // Recursive types degrade to any object.
    const target = node.$ref
      .slice(2)
      .split('/')
      .reduce<unknown>(
        (acc, token) => (isPlainObject(acc) ? acc[unescapePointer(token)] : undefined),
        root,
      );
    if (!isPlainObject(target)) return {};
    const next = new Set(seen);
    next.add(node.$ref);
    return inlineRefs(target, root, next);
  }
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) out[key] = inlineRefs(value, root, seen);
  return out;
};

// strict:true requires every object to close additionalProperties and to list
// every property in required, so optional Zod fields must still be emitted.
const enforceStrictObjects = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(enforceStrictObjects);
  if (!isPlainObject(node)) return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema' || key === '$id' || key === 'default' || key === 'definitions') continue;
    out[key] = enforceStrictObjects(value);
  }
  if (isPlainObject(out.properties)) {
    out.type = out.type ?? 'object';
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
};

export const toStructuredOutputsSchema = (schema: ZodType): Json => {
  const generated = zodToJsonSchema(schema, { $refStrategy: 'root' }) as Json;
  return enforceStrictObjects(inlineRefs(generated, generated, new Set())) as Json;
};
