import {test,expect} from '@playwright/test';
import {eq} from 'drizzle-orm';
import {unitCircleFixture} from '../../lib/whiteboard/recovery-fixtures';

test.beforeAll(async()=>{
 const url=process.env.RECOVERY_BROWSER_DATABASE_URL||process.env.TEST_DATABASE_URL||'postgresql://localhost/fahimni_recovery_dev';
 const destination=new URL(url);
 if(!['localhost','127.0.0.1','[::1]'].includes(destination.hostname)||!/test|recovery/i.test(destination.pathname))throw new Error('Isolated browser fixture database required');
 process.env.DATABASE_URL=url;
 const {getDb,closeDb}=await import('../../db');
 const {users,studentProfiles}=await import('../../db/schema');
 const db=getDb();
 const [user]=await db.select().from(users).where(eq(users.email,'dev-new-student@fahimni.local'));
 expect(user,'run dev:setup against the browser fixture database').toBeTruthy();
 await db.delete(studentProfiles).where(eq(studentProfiles.userId,user.id));
 await closeDb();
});

test('first-time student completes grade/track setup and enters a real classroom flow',async({page})=>{
 await page.route('**/api/speech',r=>r.fulfill({status:503,json:{error:'اختبار محلي فقط'}}));
 await page.route('**/api/tutor',r=>r.fulfill({json:unitCircleFixture}));
 await page.goto('/api/auth/dev-login?target=new-student');
 await expect(page).toHaveURL(/\/onboarding/);
 await page.getByText('الصف الثاني عشر (توجيهي)',{exact:true}).click();
 await page.getByText('الحقل العلمي والتكنولوجي',{exact:true}).click();
 await page.screenshot({path:'docs/reviews/recovery/after/onboarding-1440.png',fullPage:true});
 await page.getByRole('button',{name:'التالي',exact:true}).click();
 await expect(page).toHaveURL(/\/app$/);
 await expect(page.locator('.trial-card')).toBeVisible();
 const claim=page.getByRole('button',{name:'ابدأ تجربتك المجانية',exact:true});
 if(await claim.count())await claim.click();
 await expect(page.locator('.trial-card')).toContainText(/تجربتك جاهزة|تجربتك المجانية نشطة/);
 await page.getByRole('link',{name:'اختر مادتي وابدأ',exact:true}).click();
 await expect(page.getByText('رياضيات التوجيهي',{exact:true})).toBeVisible();
 await page.locator('a[href="/app/subjects/tawjihi-math/tutor"]').first().click();
 await expect(page.locator('.classroom')).toBeVisible();
 await page.getByRole('button',{name:'كتم صوت المعلم',exact:true}).click();
 await page.getByRole('textbox',{name:'سؤالك للمعلم'}).fill('اشرح دائرة الوحدة خطوة بخطوة');
 await page.getByRole('button',{name:'أرسل السؤال',exact:true}).click();
 await expect(page.locator('[data-object-id="circle"] circle')).toBeVisible();
 await page.getByRole('button',{name:'إيقاف مؤقت',exact:true}).click();
 await expect(page.getByRole('button',{name:'تشغيل',exact:true})).toBeVisible();
});
