import { credentialsComplete, freemiusCredentials } from './credentials';
import { FreemiusConfigError, freemiusClient } from './client';

export type ConnectionCheck = {
  ok: boolean;
  code: 'ok' | 'not_configured' | 'auth_failed' | 'network' | 'error';
  productId: string | null;
  productTitle: string | null;
  planCount: number;
  developerConfigured: boolean;
  message: string;
};

// Read-only verification using official SDK operations only: retrieve the
// product and its pricing table. No write calls are ever made here.
export async function checkFreemiusConnection(): Promise<ConnectionCheck> {
  const credentials = await freemiusCredentials().catch(() => null);
  if (!credentials || !credentialsComplete(credentials)) {
    return {
      ok: false,
      code: 'not_configured',
      productId: credentials?.productId ?? null,
      productTitle: null,
      planCount: 0,
      developerConfigured: Boolean(credentials?.developerId && credentials?.developerSecret),
      message: 'بيانات الربط غير مكتملة. أدخل معرّف المنتج ومفاتيح المنتج ثم أعد الاختبار.',
    };
  }
  try {
    const client = await freemiusClient();
    const product = await client.api.product.retrieve();
    const pricing = await client.api.product.retrievePricingData().catch(() => null);
    const plans = (pricing as { plans?: unknown[] } | null)?.plans;
    const planCount = Array.isArray(plans) ? plans.length : 0;
    const entity = (product ?? null) as Record<string, unknown> | null;
    return {
      ok: true,
      code: 'ok',
      productId: entity?.id !== undefined ? String(entity.id) : credentials.productId,
      productTitle: typeof entity?.title === 'string' ? entity.title : typeof entity?.name === 'string' ? entity.name : null,
      planCount,
      developerConfigured: Boolean(credentials.developerId && credentials.developerSecret),
      message: 'تم التحقق من الاتصال بفريميوس بنجاح (قراءة فقط).',
    };
  } catch (error) {
    if (error instanceof FreemiusConfigError) {
      return {
        ok: false,
        code: 'not_configured',
        productId: credentials.productId,
        productTitle: null,
        planCount: 0,
        developerConfigured: Boolean(credentials.developerId && credentials.developerSecret),
        message: 'بيانات الربط غير مكتملة.',
      };
    }
    return {
      ok: false,
      code: 'network',
      productId: credentials.productId,
      productTitle: null,
      planCount: 0,
      developerConfigured: Boolean(credentials.developerId && credentials.developerSecret),
      message: 'تعذر الوصول إلى فريميوس. تحقق من المفاتيح والاتصال ثم أعد المحاولة.',
    };
  }
}
