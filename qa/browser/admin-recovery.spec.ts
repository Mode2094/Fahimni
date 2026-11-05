import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const dir='docs/reviews/recovery/after';
mkdirSync(dir,{recursive:true});

test('admin main sections and subscription tabs remain usable',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('/api/auth/dev-login?target=admin');
 for(const path of ['/admin','/admin/students','/admin/grades','/admin/fields','/admin/subjects','/admin/readiness','/admin/settings']){
  await page.goto(path);
  await expect(page.locator('.fn-admin__main')).toBeVisible();
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Internal Server Error');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
  await page.screenshot({path:`${dir}/${path.slice(1).replaceAll('/','-')}-1440.png`,fullPage:true,caret:'initial'});
 }
 await page.goto('/admin/subscriptions');
 const tabs=await page.locator('a[href*="/admin/subscriptions?section="]').evaluateAll(links=>[...new Set(links.map(link=>(link as HTMLAnchorElement).getAttribute('href')!))]);
 expect(tabs.length).toBeGreaterThan(3);
 for(const url of tabs){
  await page.goto(url);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Internal Server Error');
  await page.screenshot({path:`${dir}/admin-subscriptions-${new URL(url,'http://local').searchParams.get('section')}-1440.png`,fullPage:true,caret:'initial'});
 }
 expect(errors).toEqual([]);
});

test('isolated development grade edit persists and is reverted through the admin form',async({page,baseURL})=>{
 test.skip(!baseURL?.startsWith('http://localhost:3010'),'Mutations allowed only in isolated local recovery server');
 await page.goto('/api/auth/dev-login?target=admin');
 await page.goto('/admin/grades');
 const edit=page.locator('tbody tr').filter({hasText:'الصف الحادي عشر'}).getByRole('link',{name:'تعديل',exact:true});
 const url=(await edit.getAttribute('href'))!;
 await page.goto(url);
 const name=page.getByLabel('اسم الصف',{exact:true});
 const original=(await name.inputValue()).replace(/ · اختبار قابل للتراجع$/u,'');
 const changed=`${original} · اختبار قابل للتراجع`;
 try{
  await name.fill(changed);
  await page.getByRole('button',{name:'حفظ',exact:true}).click();
  await page.goto(url);
  await expect(page.getByLabel('اسم الصف',{exact:true})).toHaveValue(changed);
  await page.screenshot({path:`${dir}/admin-grade-persistence-1440.png`,fullPage:true,caret:'initial'});
 }finally{
  await page.goto(url);
  await page.getByLabel('اسم الصف',{exact:true}).fill(original);
  await page.getByRole('button',{name:'حفظ',exact:true}).click();
  await page.goto(url);
  await expect(page.getByLabel('اسم الصف',{exact:true})).toHaveValue(original);
 }
});
