import type { CatalogSubject } from './store';

// Students must never be routed to the public landing page from the whiteboard
// entry points. One visible subject opens its tutor directly; otherwise the
// student picks a subject first.
export function whiteboardHrefFor(subjects: readonly CatalogSubject[]): string {
  return subjects.length === 1 ? `/app/subjects/${subjects[0].slug}/tutor` : '/app/subjects';
}
