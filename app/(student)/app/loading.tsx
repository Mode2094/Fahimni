export default function Loading() {
  return (
    <div className="fn-root fn-page">
      <main className="fn-page__main">
        <div className="fn-container">
          <div className="fn-center fn-stack" role="status" aria-live="polite">
            <span className="fn-spinner" aria-hidden="true" />
            <p className="fn-caption">جاري التحميل…</p>
          </div>
        </div>
      </main>
    </div>
  );
}
