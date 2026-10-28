import type { AdminMessage } from '../admin/messages';
import type { BookStatus } from './store';

export const BOOK_STATUS_LABELS: Record<BookStatus, string> = {
  UPLOADED: 'تم الرفع',
  PROCESSING: 'جاري الفهرسة',
  READY: 'جاهز',
  FAILED: 'فشل',
};

const STATUS_MESSAGES: Record<string, string> = {
  book_uploaded: 'تم رفع الكتاب — جاري تجهيزه.',
  book_reindexed: 'تمت جدولة إعادة الفهرسة.',
  book_deleted: 'تم حذف الكتاب.',
};

const ERROR_MESSAGES: Record<string, string> = {
  missing: 'اختر ملف PDF أولًا.',
  invalid_file: 'الملف ليس ملف PDF صالحًا.',
  too_large: 'حجم الملف يتجاوز ١٠٠ ميغابايت.',
  upload_failed: 'تعذر إكمال رفع الكتاب. لم يتغير الكتاب الحالي. حاول مرة أخرى.',
  exists: 'يوجد كتاب لهذه المادة بالفعل. استخدم خيار استبدال الكتاب.',
  storage: 'تعذر تخزين الملف على الخادم.',
  busy: 'الكتاب قيد المعالجة حاليًا. انتظر حتى تنتهي.',
  not_found: 'الكتاب غير موجود.',
  rate_limited: 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
  python_unavailable: 'أداة الفهرسة غير مثبتة على الخادم.',
  timeout: 'انتهت مهلة الفهرسة. أعد المحاولة.',
  bad_output: 'تعذر قراءة نتيجة الفهرسة.',
  extraction_failed: 'فشلت فهرسة الكتاب. أعد المحاولة.',
  indexing_failed: 'فشلت فهرسة الكتاب. أعد المحاولة.',
  low_text: 'الكتاب جاهز للتصفح، لكن النص المستخرج قليل جدًا (نسخة مصوّرة غالبًا) — البحث داخل الكتاب قد لا يعمل. يحتاج الكتاب إلى استخراج نص إضافي (OCR).',
};

export function bookStatusLabel(status: BookStatus): string {
  return BOOK_STATUS_LABELS[status];
}

export function bookMessageFromQuery(status?: string, error?: string): AdminMessage | null {
  if (error) return ERROR_MESSAGES[error] ? { type: 'error', text: ERROR_MESSAGES[error] } : null;
  if (status) return STATUS_MESSAGES[status] ? { type: 'success', text: STATUS_MESSAGES[status] } : null;
  return null;
}

export function bookErrorText(code: string | null | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.indexing_failed;
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

export function formatBookDate(date: Date): string {
  return new Intl.DateTimeFormat('ar-JO', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
