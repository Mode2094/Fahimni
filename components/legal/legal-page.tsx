import Link from 'next/link';

import { LEGAL_DOCUMENTS, LEGAL_STATUS, type LegalDocument } from '@/lib/legal/content';

// Shared renderer for every legal document. Always shows the pending-legal
// banner and cross-links the full set so the reader can navigate between them.

export function LegalDocumentPage({ document }: { document: LegalDocument }) {
  const others = LEGAL_DOCUMENTS.filter((item) => item.slug !== document.slug);
  return (
    <div className="fn-root fn-page">
      <main className="fn-container fn-stack fn-stack--lg" style={{ paddingBlock: '3rem' }}>
        <p className="fn-alert fn-alert--error" role="status">
          {LEGAL_STATUS.pendingNote}
        </p>
        <header className="fn-stack fn-stack--sm">
          <p className="fn-eyebrow">المستندات القانونية</p>
          <h1 className="fn-display fn-display--xl">{document.title}</h1>
          <p className="fn-subtitle">{document.summary}</p>
        </header>
        <div className="fn-stack">
          {document.sections.map((section) => (
            <section className="fn-stack fn-stack--sm" key={section.heading}>
              <h2 className="fn-title">{section.heading}</h2>
              <p className="fn-subtitle">{section.body}</p>
            </section>
          ))}
        </div>
        <nav className="fn-row fn-row--wrap" aria-label="مستندات قانونية أخرى">
          {others.map((item) => (
            <Link className="fn-btn fn-btn--outline fn-btn--sm" href={`/${item.slug}`} key={item.slug}>
              {item.title}
            </Link>
          ))}
          <Link className="fn-btn fn-btn--ghost fn-btn--sm" href="/">
            العودة للرئيسية
          </Link>
        </nav>
      </main>
    </div>
  );
}

export function legalMetadata(document: LegalDocument) {
  return {
    title: `${document.title} (مسودة للمراجعة القانونية)`,
    description: `${document.summary} — مسودة قيد المراجعة القانونية.`,
    alternates: { canonical: `/${document.slug}` },
    robots: { index: false, follow: false },
  };
}
