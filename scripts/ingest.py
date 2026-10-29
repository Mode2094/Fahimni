"""Usage: python scripts/ingest.py book.pdf. pip install pymupdf
Persist page-level text, structured metadata, equation candidates, and source images.
Use visual pages for fidelity: PDF extraction does not preserve every math glyph.
"""
import fitz,json,re,sys,hashlib,unicodedata,pathlib
root=pathlib.Path(__file__).resolve().parent.parent
pdf=pathlib.Path(sys.argv[1]); doc=fitz.open(pdf)
# Verified against the supplied book's table of contents; use --catalog for another book.
catalog=[(6,'المعادلات','تمهيد'),(8,'المعادلات','حل معادلات خاصة'),(16,'المعادلات','حل أنظمة المعادلات بيانيا'),(18,'المعادلات','حل نظام مكون من معادلة خطية ومعادلة تربيعية'),(25,'المعادلات','حل نظام مكون من معادلتين تربيعيتين'),(31,'المعادلات','اختبار نهاية الوحدة'),(32,'الدائرة','تمهيد'),(34,'الدائرة','أوتار الدائرة وأقطارها ومماساتها'),(41,'الدائرة','الأقواس والقطاعات الدائرية'),(47,'الدائرة','الزوايا في الدائرة'),(54,'الدائرة','معادلة الدائرة'),(62,'الدائرة','اختبار نهاية الوحدة'),(64,'حساب المثلثات','تمهيد'),(66,'حساب المثلثات','النسب المثلثية'),(74,'حساب المثلثات','النسب المثلثية للزوايا ضمن الدورة الواحدة'),(82,'حساب المثلثات','تمثيل الاقترانات المثلثية'),(88,'حساب المثلثات','حل المعادلات المثلثية'),(96,'حساب المثلثات','اختبار نهاية الوحدة'),(98,'تطبيقات المثلثات','تمهيد'),(100,'تطبيقات المثلثات','الاتجاه من الشمال'),(106,'تطبيقات المثلثات','قانون الجيوب'),(113,'تطبيقات المثلثات','قانون جيوب التمام'),(119,'تطبيقات المثلثات','استعمال جيب الزاوية لإيجاد مساحة المثلث'),(124,'تطبيقات المثلثات','حل مسائل ثلاثية الأبعاد'),(130,'تطبيقات المثلثات','اختبار نهاية الوحدة')]
if '--catalog' in sys.argv:catalog=json.loads(pathlib.Path(sys.argv[sys.argv.index('--catalog')+1]).read_text())
def clean(s):
 s=unicodedata.normalize('NFKC',s)
 s=re.sub(r'[\u0610-\u061a\u064b-\u065f\u0670\u200e\u200f\u202a-\u202e\u0640\ufffd]','',s)
 return re.sub(r'[ \t]+',' ',s).strip()
sha=hashlib.sha256(pdf.read_bytes()).hexdigest(); source='math10-'+sha[:12]
out=root/'assets/legacy-textbook';out.mkdir(parents=True,exist_ok=True)
records=[]
for i,p in enumerate(doc):
 page=i+1; text=clean(p.get_text(sort=False)); title=next((x for x in reversed(catalog) if page>=x[0]),(1,'مقدمة','مقدمة'))
 # Printed footer verified individually; unknown pages remain null rather than guessed.
 foot=p.get_text(clip=fitz.Rect(0,p.rect.height-50,p.rect.width,p.rect.height)); nums=re.findall(r'(?m)^\s*(\d{1,3})\s*$',foot)
 printed=int(nums[-1]) if nums else None
 if page>=6:
  p.get_pixmap(matrix=fitz.Matrix(1.4,1.4),alpha=False).save(out/f'{page}.jpg')
  lines=text.splitlines(); equations=[x.strip() for x in lines if re.search(r'[=≠≤≥]|[a-z].*[+−×÷]',x)]
  records.append(dict(id=f'{source}-p{page}',sourceId=source,pdfPage=page,printedPage=printed,unit=title[1],chapter=title[1],lesson=title[2],section='صفحة',heading=title[2],text=text,equations=equations,image=f'/book/{page}.jpg',metadata={'extraction':'pymupdf-text+page-image','mathFidelity':'consult-page-image','hasImages':bool(p.get_images()),'hasDrawings':bool(p.get_drawings())}))
(root/'data').mkdir(exist_ok=True)
(root/'data/textbook.json').write_text(json.dumps(records,ensure_ascii=False))
(root/'data/manifest.json').write_text(json.dumps(dict(sourceId=source,sha256=sha,totalPages=len(doc),indexedPages=len(records),catalog=catalog),ensure_ascii=False))
print(json.dumps({'pages':len(doc),'indexed':len(records),'printed_verified':sum(x['printedPage']==x['pdfPage'] for x in records),'source':source}))
