# PHASE5_DEPLOYMENT_PREFLIGHT — تقرير جاهزية النشر التجريبي (Staging)

- **التاريخ:** 2026-10-08 · **الحالة:** تقرير تحضيري فقط — **لم يُنشر أي شيء**
- **القيد الأساسي:** عدم المساس بـ LooksLoop أو أي مشروع/حاوية/شبكة/وحدة تخزين قائمة على VPS
- **البوابة:** فريميوس فقط — لا مدفوعات حقيقية ولا تعديل خطط حية

---

## 1) الجاهز — عناصر مكتملة ومُختبرة محليًا

| العنصر | الحالة |
|---|---|
| حزمة Docker (ويب + عامل الفهرسة PyMuPDF + Postgres 16 + Redis 7) | جاهزة — `Dockerfile` + `deploy/docker-compose.production.yml` |
| العزل الكامل | أسماء مشروع/حاويات/شبكة/وحدات تخزين فريدة (`fahimni-*`)، الويب على `127.0.0.1:3100` فقط، لا منافذ عامة لقاعدة البيانات/Redis |
| معاملات Staging | نفس ملف Compose أصبح مُعامَلًا (`STACK_PREFIX`, `WEB_PORT`, `POSTGRES_DB`, `DATA_HOST_DIR`, `DATA_CONTAINER_DIR`, `ENV_FILE`) — **مُتحقق بـ `docker compose config`**: staging ⇒ مشروع `fahimni-staging`، حاويات `fahimni-staging-*`، منفذ 3101، قاعدة `fahimni_staging`، بيانات `/data/fahimni-staging`، وحدات `fahimni-staging-pg-data/redis-data`؛ والإنتاج افتراضيًّا بلا أي تغيير (منفذ 3100، `/data/fahimni`) |
| مثال بيئة Staging | `deploy/env.staging.example` (قيم منفصلة، مفتاح تشفير خاص بالـ staging، متغيرات العزل) + `/deploy/env.staging` مضاف إلى `.gitignore` |
| ملاحظة مهمة | أُلغي ملف override منفصل: دمج Compose **يجمع** قوائم `ports`/`volumes` بدل استبدالها، ما كان سيُبقي منفذ 3100 ومسار الإنتاج في staging — الحل المُتحقق هو الملف المُعامَل الواحد |
| استمرارية البيانات | Postgres/Redis: وحدات تخزين مُسمّاة؛ الكتب/الصفحات/صور المواد: bind mount host `/data/fahimni` للويب والعامل |
| فحوص الصحة | `/api/health` (قاعدة + Redis) + healthcheck لكل خدمة في Compose |
| النسخ الاحتياطي | `scripts/backup.sh` يشمل الآن DB + كتب + **uploads**؛ `PG_CONTAINER`/`DATA_DIR`/`BACKUP_DIR` قابلة للتمرير |
| **اختبار نسخ/استرجاع فعلي (بيانات معزولة)** | ✅ تم: `pg_dump → gunzip → psql` إلى قاعدة مؤقتة (23 جدولًا، المستخدمون/العروض/الإعدادات سليمة) ثم حذفها؛ وأرشيف الملفات (كتب + uploads) دورة كاملة بنجاح |
| اختبارات | 168/168 + typecheck + build + build:next |
| رؤوس أمان + HSTS | `lib/security/headers.ts` (HSTS فقط عند `production && https` عبر `x-forwarded-proto`) |
| حدود التكلفة | حدود معدل لكل عملية + ميزانية تجربة + ميزانية ذكاء عامة اختيارية (0 = بلا حد) |

## 2) الوصول إلى VPS — غير متاح حاليًا (يلزم إجراء يدوي)

- يوجد IP في `known_hosts` (`187.127.87.101`) لكن **كل المفاتيح المتاحة رُفضت** (`Permission denied (publickey)`) للمستخدمين root/ubuntu — لا يوجد Host alias في `~/.ssh/config` سوى GitHub.
- **لا يمكن تنفيذ فحوص القراءة فقط تلقائيًا.** شغّل يدويًا على VPS وسلّم المخرجات:

```bash
uname -a; nproc; free -m; df -h /; df -h /data 2>/dev/null || true
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
docker volume ls; docker network ls
ss -tlnp | grep -E ':(80|443|3000|3100|3101|5432|6379)\b' || true
ls -la /data 2>/dev/null
crontab -l 2>/dev/null || true
```

## 3) مخاطر التصادم على VPS

| الخطر | الحالة | المعالجة |
|---|---|---|
| أسماء حاويات/شبكة/وحدات إنتاجية ثابتة في Compose | مؤكد | لا تشغّل ملف الإنتاج وحده للـ staging — استخدم تراكب `docker-compose.staging.yml` الذي يعيد تسمية كل شيء |
| منفذ 3100 | مستخدم للإنتاج | staging على **3101** حصريًا (127.0.0.1) |
| شبكة `fahimni-net` | قد تتصادم لو وُجد إنتاج | التراكب يستخدم `fahimni-staging-net` |
| منافذ 80/443 | تخص LooksLoop غالبًا | **لا تلمس أي server block قائم** — أضف ملف nginx جديدًا فقط (أدناه) |
| PostgreSQL/Redis الخاصان بـ LooksLoop | غير معروفين | لا تنشر أي منفذ لقاعدة staging؛ لا تعِد استخدام شبكات/وحدات الآخرين |

## 4) تدقيق التكوين (بدون طباعة أي قيم)

| المتغير | محليًا | مطلوب للإنتاج/Staging |
|---|---|---|
| `DATABASE_URL` | ✅ | إلزامي |
| `REDIS_URL` | ❌ (ذاكرة فقط في التطوير) | **إلزامي في الإنتاج** (حدود المعدل والميزانيات) |
| `AUTH_SECRET` | ✅ | إلزامي |
| `SETTINGS_ENCRYPTION_KEY` | ✅ (محليًا) | إلزامي قبل حفظ مفاتيح الإدارة — **مفتاح منفصل للـ staging** |
| `GOOGLE_CLIENT_ID/SECRET` | ✅ | إلزامي |
| `ADMIN_EMAILS` | ✅ (يتضمن حساب اختبار محلي) | في الإنتاج: بريد المالك الحقيقي فقط — **إزالة `admin@fahimni.local`** |
| `OPENAI_API_KEY` | ✅ (بيئة) | اختياري كاحتياطي — المفتاح القابل للتدوير من لوحة الإدارة يعمل بعد النشر |
| مفاتيح `FREEMIUS_*` | ❌ (متوقع) | تُدخل من لوحة الإدارة (مشفّرة) أو بيئة |
| `TURNSTILE_*` | ❌ | **إلزامي للإنتاج** (تفعيل التجربة يفشل مغلقًا بدونه) |
| `TRIAL_DAILY_AI_BUDGET_USD` | ❌ | موصى به (مثال 5) |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | ❌ | غير مطلوب — واتساب يُدار من لوحة الإدارة (قاعدة البيانات) |
| `TUTOR_DIAGNOSTICS` / `NEXT_PUBLIC_VISUAL_DEV_MODE` | ✅ محليًا | **يجب عدم نقلهما** إلى staging/الإنتاج |
| `DATA_DIR` | غير مضبوط (يستخدم `.data`) | `/data/fahimni` (إنتاج) و`/data/fahimni-staging` (staging) |

الإعدادات المحفوظة من لوحة الإدارة (مفتاح AI، واتساب، فريميوس) تعيش في PostgreSQL وتُشفَّر بمفتاح الجذر — تعمل بعد النشر بشرط **نفس `SETTINGS_ENCRYPTION_KEY`** المستخدم عند حفظها.

## 5) بوابات إطلاق فريميوس

| البوابة | الحالة |
|---|---|
| ربط تاجر حقيقي + هوية المنتج | ⛔ غير قابل للتحقق محليًا (لا مفاتيح) — يتحقق منه المالك عبر Settings → فريميوس → اختبار الاتصال (قراءة فقط) |
| تعيين الخطط والأسعار | جاهز تقنيًا: التحقق يقرأ الخطة/التسعير الرسمي؛ **لا يصل أي عرض للدفع قبل تطابق تام** |
| عملة الدفع | **قرار مطلوب:** فريميوس لا تدعم JOD كعملة checkout — اختر عملة التسوية (مثل USD) واجعل عملة العرض مطابقة؛ التحقق يفشل عند أي اختلاف |
| الفوترة المتكررة (شهري) | خطة شهرية بسعر شهري في فريميوس |
| الفصل (دفعة واحدة) | تُربط بتسعير one-off (lifetime pricing) — الوصول ينتهي بنهاية الفصل من جهتنا |
| ويبهوك | المسار `/api/webhooks/freemius` + سر التوقيع — يُسجَّل في لوحة فريميوس؛ الرفض 503 عند غياب التهيئة |
| تجديد/إلغاء الاشتراكات | منطق lifecycle قائم ومختبَر (يبقى الوصول حتى تاريخ الدفع، والإلغاء يُحترم) |
| شراء عدة مواد لنفس الطالب | مدعوم من جهتنا (ترخيص/استحقاق مستقل لكل شراء) — يجب أن يسمح إعداد المنتج في فريميوس بذلك |
| إنشاء الخطط تلقائيًا | ⛔ **محجوب** — يتطلب developer scope؛ لا يُعد مكتملًا حتى يُختبر على حساب فريميوس الحقيقي |
| خطط demo | لا تُعد جاهزة أبدًا (حارس `plan_demo*` + شرط الربط المُتحقق) |

## 6) Google OAuth

- Redirect URIs المطلوب تسجيلها:
  - Staging: `https://<staging-domain>/api/auth/google/callback`
  - الإنتاج: `https://<production-domain>/api/auth/google/callback`
- الوضع الحالي: OAuth يعتمد `requestOrigin` — **يجب أن يمرر الـ reverse proxy** `X-Forwarded-Proto: https` و`X-Forwarded-Host` وإلا بُنيت عناوين إعادة توجيه خاطئة.
- الشاشة: External + scopes أساسية (email/profile) — يكفي النشر (Publish) للإنتاج؛ مرحلة Testing تكفي للـ staging مع إضافة حسابات اختبار.
- **لا يُعد جاهزًا للإنتاج قبل تسجيل دخول ناجح فعلي على نطاق HTTPS منشور.**

## 7) الأداء على VPS بـ 8GB/2vCPU قد يستضيف مشاريع أخرى

| البند | القيمة/التوصية |
|---|---|
| الويب (Next standalone) | ~200–400MB ذاكرة تشغيل |
| PostgreSQL | افتراضي معقول للبداية؛ اتصالات التطبيق محدودة بـ `DATABASE_POOL_MAX` (افتراضي 5) — ارفعه فقط عند الحاجة |
| Redis | AOF مفعّل؛ ذاكرة صغيرة (معدلات + ميزانيات) |
| عامل الفهرسة | كتاب واحد في المرة، polling 5s؛ PyMuPDF يستهلك CPU عند الفهرسة فقط — لا ترفع التزامن |
| حدود الرفع | كتاب PDF ≤100MB، صورة مادة ≤5MB (تحقق magic-bytes) |
| حدود AI | tutor 20/5د، vision/STT 12/10د، TTS 120/5د + حدود تجربة أشد + burst؛ **اضبط ميزانية الذكاء العامة اليومية من الإدارة (مثل $5)** لمنع كلفة غير محدودة |
| السجلات | لا أسرار في السجلات (تحقق مرحلة 3)؛ `TUTOR_DIAGNOSTICS=false` |
| TLS | عبر الـ proxy؛ التطبيق يضيف HSTS عند HTTPS إنتاجي؛ رؤوس CSP صارمة قائمة |
| النسخ الاحتياطي | cron يومي: `BACKUP_DIR=/var/backups/fahimni bash scripts/backup.sh` + نسخة خارجية؛ احفظ `SETTINGS_ENCRYPTION_KEY` في مدير أسرار |
| إعادة التشغيل | `restart: unless-stopped` لكل الخدمات |

## 8) تسلسل نشر Staging (لا يُنفَّذ الآن)

```bash
# 0) (يدويًا على VPS) تحقق من عدم التصادم أولًا:
docker ps --format '{{.Names}}'; ss -tln | grep -E '3101|3100' || true

# 1) على VPS: نسخ المستودع إلى مسار مستقل
mkdir -p /opt/fahimni && cd /opt/fahimni   # نسخ الكود (git أو rsync)

# 2) تجهيز البيئة والتخزين المعزول
cp deploy/env.staging.example deploy/env.staging   # املأ القيم (لا تُلتزم في git)
mkdir -p /data/fahimni-staging

# 3) بناء وتشغيل قاعدة/كاش staging فقط
docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml build
docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml up -d fahimni-postgres fahimni-redis

# 4) الترحيل + البيانات الأولية (مرة واحدة)
docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml run --rm fahimni-web pnpm db:migrate
docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml run --rm fahimni-web pnpm db:seed

# 5) تشغيل الكل والتحقق
docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml up -d
curl -s http://127.0.0.1:3101/api/health
```

**nginx — ملف جديد فقط (لا تعدّل أي server block قائم):** `/etc/nginx/sites-available/fahimni-staging`

```nginx
server {
  listen 443 ssl;
  server_name <staging-domain>;
  # شهادات Let's Encrypt الخاصة بـ staging فقط
  ssl_certificate     /etc/letsencrypt/live/<staging-domain>/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/<staging-domain>/privkey.pem;

  # حماية staging: لا تُعرَّض للعامة بدون تحكم بالوصول
  auth_basic "Fahimni Staging";
  auth_basic_user_file /etc/nginx/.htpasswd-fahimni-staging;
  add_header X-Robots-Tag "noindex, nofollow" always;

  location / {
    proxy_pass http://127.0.0.1:3101;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

فحوص ما بعد النشر (يدويًا): `/api/health` = ok · تسجيل دخول Google تجريبي · رفع صورة مادة وظهورها للطالب · اختبار اتصال فريميوس (قراءة فقط) · حالة العروض تبقى «بانتظار الربط» حتى التحقق الحقيقي.

## 9) خطة التراجع (Rollback)

```bash
# إيقاف staging فقط (لا يمس أي مشروع آخر)
docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml down

# تراجع تطبيقي: استرجاع نسخة قاعدة البيانات قبل آخر ترحيل + إعادة نشر الصورة السابقة
gunzip -c /var/backups/fahimni/fahimni-db-<stamp>.sql.gz | \
  docker exec -i fahimni-staging-postgres psql -U fahimni -d fahimni_staging
# الملفات (كتب/uploads) مستقلة عن الإصدار: استرجاعها من أرشيف DATA_DIR عند الحاجة

# حذف كامل لبيانات staging (اختياري، عند الإلغاء):
# docker compose --env-file deploy/env.staging -f deploy/docker-compose.production.yml down -v   # يحذف وحدات fahimni-staging-* فقط
```

- الترحيلات forward-only: التراجع = استرجاع نسخة DB + صورة سابقة.
- مفتاح `SETTINGS_ENCRYPTION_KEY` لا يُستعاد من نسخة DB — يُدار في مدير أسرار.

## 10) معلومات مطلوبة من المالك (بدونها لا نشر)

1. **نطاق staging الحقيقي** + من يملك DNS (نحتاج سجل A إلى VPS).
2. نطاق الإنتاج النهائي (لتسجيل Google/Freemius مسبقًا).
3. **وصول SSH** (مستخدم + مفتاح مصرّح) أو تنفيذ الأوامر اليدوية أعلاه ولصق المخرجات.
4. ناتج فحوص VPS (CPU/RAM/قرص/حاويات/منافذ) — لتأكيد عدم التصادم.
5. حساب Google: إضافة redirect URIs أعلاه (+ حسابات اختبار للـ staging).
6. فريميوس: منتج staging/اختباري + **قرار عملة التسوية** + تسجيل Webhook وسرّه + تأكيد السماح بعدة تراخيص/شراءات.
7. بريد المالك لقائمة `ADMIN_EMAILS` الإنتاجية (بدون حسابات اختبار).
8. طريقة حماية staging (Basic Auth كما أعلاه — موصى به — أو تقييد IP).
9. تفضيل جدولة النسخ الاحتياطي (وقت cron) ومسار نسخة خارجية.

## 11) المخاوف الأمنية المفتوحة

- إزالة علمي التطوير من بيئة النشر (`TUTOR_DIAGNOSTICS`, `NEXT_PUBLIC_VISUAL_DEV_MODE`).
- `ADMIN_EMAILS` الإنتاجي = المالك فقط.
- Basic Auth/noindex للـ staging إلزاميان قبل أي تعريض.
- مفتاح تشفير منفصل لكل بيئة + نسخ خارجية للنسخ الاحتياطية.
- لا منافذ عامة لـ Postgres/Redis (مؤكد في Compose).
- فحوص قراءة فقط لفريميوس في هذه المرحلة — **صفر كتابات حية**.

## 12) نتائج البوابات النهائية

- `pnpm typecheck` ✅ · `pnpm test` ✅ 168/168 · `pnpm build:next` ✅
- اختبار نسخ/استرجاع معزول ✅ (DB + ملفات)
- لم يُنفَّذ أي نشر أو دفع حقيقي، ولم يُلمس LooksLoop.
