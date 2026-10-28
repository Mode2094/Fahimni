import type {Metadata,Viewport} from 'next';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import 'katex/dist/katex.min.css';
import './globals.css';
import './design-system.css';
import {ServiceWorkerRegister} from '../components/pwa/pwa-provider';
import {SETTING_KEYS} from '../lib/settings/keys';
import {getPlainSetting} from '../lib/settings/service';
// The platform name is admin-managed at runtime; the built-in default is used
// until the owner saves a value or when the settings store is unavailable.
export async function generateMetadata():Promise<Metadata>{
 let name='فهمني';
 try{
  const stored=await getPlainSetting(SETTING_KEYS.platformName);
  if(stored?.trim())name=stored.trim().slice(0,40);
 }catch{/* keep the default */}
 return {metadataBase:new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim()||'https://fahimni.me'),alternates:{canonical:'/'},applicationName:name,title:{default:`${name} | معلّمك الذكي من كتابك`,template:`%s | ${name}`},description:'معلّمك الذكي من كتابك: اطرح سؤالك نصًا أو صورة أو صوتًا، واحصل على شرح واضح خطوة بخطوة على سبورة تفاعلية وفق المنهاج الأردني.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg',apple:'/icons/apple-touch-icon.png'},manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:name,statusBarStyle:'default'},openGraph:{type:'website',locale:'ar_JO',url:'/',siteName:name,title:`${name} | معلّمك الذكي من كتابك`,description:'اشرح خطوة بخطوة مع مدرّسك الذكي من كتابك، بالصوت والصورة، في أي وقت.'}};
}
export const viewport:Viewport={themeColor:'#f5f4fb',colorScheme:'light',interactiveWidget:'resizes-content'};
// Development escape hatch: this inline script ships inside the HTML (which the
// service worker never caches), so it can clean up a stale dev service worker
// even when cached old chunks would otherwise keep serving the previous build.
// It runs only in development, unregisters any worker, purges Fahimni caches,
// and reloads once so the page continues without a stale controller.
const DEV_SW_CLEANUP=`(function(){try{if(!('serviceWorker' in navigator))return;var KEY='fahimni-sw-dev-reset';navigator.serviceWorker.getRegistrations().then(function(regs){var controlled=!!navigator.serviceWorker.controller;return Promise.all(regs.map(function(r){return r.unregister()})).then(function(){if(!('caches' in window))return;return caches.keys().then(function(keys){return Promise.all(keys.filter(function(k){return k.indexOf('fahimni-')===0}).map(function(k){return caches.delete(k)}))})}).then(function(){if(!controlled)return;var done=false;try{done=sessionStorage.getItem(KEY)==='1'}catch(e){}if(done)return;try{sessionStorage.setItem(KEY,'1')}catch(e){}location.reload()})}).catch(function(){})}catch(e){}})();`;
// Extensions such as Grammarly inject attributes onto <body> before React
// hydrates. Scoped to the body element only, so unrelated hydration mismatches
// anywhere else in the tree still surface.
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl"><body suppressHydrationWarning>{process.env.NODE_ENV!=='production'&&<script dangerouslySetInnerHTML={{__html:DEV_SW_CLEANUP}}/>}<ServiceWorkerRegister/>{children}</body></html>}
