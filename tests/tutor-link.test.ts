import { test } from 'node:test';
import assert from 'node:assert/strict';

import { whiteboardHrefFor } from '../lib/student/tutor-link';
import type { CatalogSubject } from '../lib/student/store';

function subject(slug: string): CatalogSubject {
  return {
    id: slug,
    gradeId: 'g',
    academicFieldId: null,
    name: slug,
    slug,
    shortDescription: null,
    image: null,
    isActive: true,
    isFeatured: false,
    sortOrder: 0,
  };
}

test('whiteboard entry: one subject opens its tutor, otherwise subject selection', () => {
  assert.equal(whiteboardHrefFor([]), '/app/subjects');
  assert.equal(whiteboardHrefFor([subject('tawjihi-math')]), '/app/subjects/tawjihi-math/tutor');
  assert.equal(whiteboardHrefFor([subject('a'), subject('b')]), '/app/subjects');
});
