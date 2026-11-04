# فهمني — منصة تعليمية عربية تفاعلية (FAHIMNI)

منصة تعليمية عربية أولًا (RTL) تشرح المنهاج عبر سبورة ذكية ومعلّم ذكي مدعوم
بالذكاء الاصطناعي، بنموذج اشتراك فصلي واحد ورصيد موحّد.

> الحالة: **مرشّح إصدار للاستخدام المقيّد (pilot)**. لم يُنشر للإنتاج، ولم
> يُفعّل أي دفع حقيقي. راجع `docs/release/` لسجل الجاهزية الكامل والنواقص.

## نموذج العمل

- **عرض مدفوع عام واحد:** «اشتراك فهمني الفصلي» يمنح الوصول إلى **كل مادة جاهزة
  ومصرّح بها** لصف الطالب وحقله خلال الفصل، مع **رصيد موحّد**.
- لا توجد خطط شهرية أو خطط خاصة بمادة واحدة معروضة للشراء العام.
- **رصيد الفصل** ينتهي بانتهاء الفصل، و**الرصيد المشترى** يبقى في الحساب.
- يمكن شحن رصيد إضافي دون شراء اشتراك جديد.

## المعمارية

- Next.js App Router + React + TypeScript، RTL، نظام تصميم واحد (`app/design-system.css`).
- PostgreSQL عبر Drizzle (ترحيلات في `drizzle/`)، Redis للحدود والميزانيات.
- مصادقة عبر Google OAuth، جلسات مُجزّأة (HMAC)، وصول مشرف بسجل تدقيق.
- مزوّد الذكاء الاصطناعي: OpenAI (نص/بصر/تحويل صوتي/توليد صوت)؛ اختياريًا مسار
  تطوير بصري.
- الدفع: تكامل Freemius (يتطلب عملة مدعومة — انظر النواقص أدناه).
- عامل فهرسة الكتب منفصل (`scripts/index-worker.ts`).

## التشغيل محليًا

يتطلب Node.js 22+ و pnpm 11.

```bash
pnpm install
cp .env.example .env.local      # ضع المفاتيح هنا، لا ترفعها إلى Git
pnpm dev:next
```

قاعدة البيانات والـ Redis مطلوبان لتشغيل كامل. راجع متغيرات البيئة في
`.env.example` و`deploy/env.production.example`.

## النشر (Docker)

راجع [deploy/README.md](deploy/README.md). الحزمة المعزولة: `fahimni-web`،
`fahimni-worker`، `fahimni-postgres`، `fahimni-redis` على شبكة خاصة، مع نشر
الويب على `127.0.0.1` خلف reverse proxy.

```bash
docker compose -f deploy/docker-compose.production.yml --env-file deploy/env.production up -d postgres redis
docker compose -f deploy/docker-compose.production.yml --env-file deploy/env.production run --rm fahimni-web pnpm db:migrate
docker compose -f deploy/docker-compose.production.yml --env-file deploy/env.production run --rm fahimni-web pnpm db:seed   # أول تشغيل فقط
docker compose -f deploy/docker-compose.production.yml --env-file deploy/env.production up -d
```

- النسخ الاحتياطي: `bash scripts/backup.sh`.
- فحص الصحة: `GET /api/health`.
- الصفحة الجذرية `/` تعريفية؛ السبورة القديمة (`/legacy`) للتطوير فقط وتعيد
  التوجيه في الإنتاج.

## الإدارة

لوحة الإدارة (`/admin`) تشمل: الطلاب، الصفوف، الحقول، المواد ورفع الكتب
وفهرستها، **الفصول والاشتراكات** (اشتراكات، كريدت وشحن، مدفوعات، تقارير مالية،
إعدادات الاستهلاك)، **جاهزية الإطلاق**، والإعدادات (الذكاء الاصطناعي، التجربة،
الأجهزة، فريميوس).

## الاختبارات والتحقق

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build:next
```

- 45 ملف اختبار، منها 11 اختبار تكامل حقيقي على PostgreSQL (تُفعَّل بمتغير
  `TEST_DATABASE_URL`).
- يجب تشغيل الاختبارات على Node 22 مع PostgreSQL و Redis حقيقيين لمطابقة CI.
- تفاصيل النتائج والدليل في `docs/release/07-test-and-ci-evidence.md`.

## إخلاء المسؤولية والحالة الصادقة

- لا توجد إجابات ذكاء اصطناعي وهمية أو دروس ثابتة في مسارات الإنتاج؛ اختبارات
  الخدمات تستخدم ناقلاً مزيفًا داخل `tests/` فقط.
- الشرح المولّد قد يخطئ؛ الواجهة تُفصح عن ذلك وتشير إلى مراجعة الكتاب.
- حقوق الكتب تبقى لأصحابها؛ لا تُنشر مادة دون تصريح مالك الحقوق.
- **نواقص إطلاق خارجية:** عملة الدفع (فريميوس لا يدعم JOD حاليًا)، محتوى الكتب
  المرخّص، التحقق على بيئة staging، والاعتماد القانوني. راجع
  `docs/release/08-launch-blockers-and-owner-actions.md`.
