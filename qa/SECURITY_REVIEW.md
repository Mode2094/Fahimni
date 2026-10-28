# SECURITY_REVIEW — المراجعة الأمنية

## 1) المصادقة والجلسات

| البند | النتيجة | الدليل |
|---|---|---|
| جلسات DB + HMAC، كوكي `httpOnly` + `sameSite=lax` + `secure` في الإنتاج | ✅ | `lib/auth/session.ts:8-18`, `lib/auth/env.ts:59` |
| جلسة منتهية/مزيفة → إعادة توجيه login | ✅ | `audit-targeted.json` |
| OAuth state cookie (PKCE + state) بنفس الخصائص | ✅ | `lib/auth/oauth.ts:25-28` |
| `returnTo` مُعقَّم (لا Open Redirect) | ✅ → `/app` | `audit-targeted.json` |
| RTL/ترويسة: لا تسريب كوكيز في الاستجابات | ✅ | فحوص HTTP |

## 2) التفويض (Authorization)

| الفحص | النتيجة |
|---|---|
| APIs الذكاء بدون جلسة | 401 ✅ |
| APIs الإدارة بدون/بغير صلاحية | 303 login / 403 ✅ |
| `/admin` لطالب | تحويل `/app` ✅ |
| AI بلا استحقاق | 403 ✅ |
| Speech بنطاق مادة غير مسموح | 401/403 ✅ |
| صفحات الكتاب بدون جلسة | 401 ✅ |
| **صفحات الكتاب: استحقاق/تجربة** | ⚠️ P2: تُصادق بالظهور لا الاستحقاق (UUID غير قابل للتخمين + 404 غامض) |
| إلغاء جهاز ليس للمستخدم | رفض ✅ (ملكية مثبتة) |

## 3) CSRF

- كل طلبات POST الحساسة (admin، checkout، logout) من عرض آخر → **403** ✅
- نمط same-origin + تحقق Origin/Referer مطبّق في الراوتس.

## 4) الرؤوس والـ CSP (فعلي من الاستجابة)

```
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'
  https://checkout.freemius.com https://accounts.google.com; object-src 'none';
  base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://checkout.freemius.com
x-frame-options: DENY · x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(self), microphone=(self), geolocation=(), payment=()
```
- لا `unsafe-eval` ✅ · كاميرا/مايك محصوران بالذات (لازم لرؤية/صوت) ✅
- ملاحظة إنتاج: تفعيل HSTS على المضيف/الـ proxy (غير مطبق محليًا http).

## 5) إساءة التجربة (Trial Abuse) — مصفوفة مُختبرة

| المتجه | النتيجة |
|---|---|
| نفس المتصفح + حساب جديد | 409 `browser_used` ✅ |
| نفس الحساب + نفس المتصفح مرتين | نتيجة ثابتة (idempotent) ✅ |
| حساب مدفوع يحاول التجربة | 409 `already_subscribed` ✅ |
| تكرار سريع للمطالبة | 429 بعد 10 ✅ |
| بدون جلسة | 401 ✅ |
| جهاز ثالث | 403 ✅ |

## 6) الدفع والويبهوك

- أسعار لا تُقبل من العميل (سعر مزيّف → 400) ✅
- عرض بنطاق خاطئ → 404 ✅
- غير مهيأ → 503 `not_configured` (لا تكهن بالأسعار) ✅
- ويبهوك غير موقّع → 503 (يرفض قبل أي معالجة) ✅
- Freemius الحقيقي + توقيع الويبهوك الفعلي ⛔ BLOCKED (مفاتيح غير مهيأة محليًا)

## 7) الأسرار والتسريبات

- فحص 6 حزم عميل: **لا أنماط أسرار** (مفاتيح/توكنات) ✅
- `AUTH_SECRET`/`GOOGLE_CLIENT_SECRET`/`FREEMIUS_*` لا تظهر في مخرجات التدقيق ✅
- جلسات التدقيق في `/tmp` (0600) وحُذفت؛ لا كوكيز مطبوعة في التقارير ✅

## 8) سلامة المدخلات

- التحقق من إدخال onboarding (`field_required`/`invalid_field`) ✅
- رفض رفع ملف غير صالح ✅
- رؤية/صوت: مدخلات غير صالحة → 400/422 مع استرداد ✅
- حقن الأوامر عبر النص: بقي الدرس في سياق المسألة (نجاح جزئي — لا إخراج ضار) ✅/⚠️

## 9) الخلاصة

- **0 ثغرات P0/P1**. النموذج الأمني (جلسات، تفويض، CSRF، رؤوس، تجربة، دفع) صلب وثابت بالاختبار.
- العنصران الموصى بهما: استحقاق صفحات الكتاب (P2) وضبط اختبارات الدفع الحقيقية على Staging.
