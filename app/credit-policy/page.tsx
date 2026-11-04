import { LegalDocumentPage, legalMetadata } from '@/components/legal/legal-page';
import { LEGAL_DOCUMENTS } from '@/lib/legal/content';

const document = LEGAL_DOCUMENTS.find((item) => item.slug === 'credit-policy')!;

export const metadata = legalMetadata(document);

export default function Page() {
  return <LegalDocumentPage document={document} />;
}
