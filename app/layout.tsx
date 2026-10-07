import type {Metadata} from 'next';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import 'katex/dist/katex.min.css';
import './globals.css';
export const metadata:Metadata={title:'مَدار | معلّم الرياضيات',description:'رياضيات الصف العاشر، خطوة بخطوة على سبورة تفاعلية مستندة إلى كتابك.',icons:{icon:'/favicon.svg'}};
// Extensions such as Grammarly inject attributes onto <body> before React
// hydrates. Scoped to the body element only, so unrelated hydration mismatches
// anywhere else in the tree still surface.
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl"><body suppressHydrationWarning>{children}</body></html>}
