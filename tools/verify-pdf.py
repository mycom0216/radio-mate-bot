import json, pathlib, subprocess
from pypdf import PdfReader
from PIL import Image, ImageOps, ImageDraw
root=pathlib.Path(__file__).resolve().parent.parent
poppler=pathlib.Path(r'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt/dependencies/native/poppler/Library/bin/pdftoppm.exe')
out=root/'tmp/pdf-qa';out.mkdir(parents=True,exist_ok=True)
entries=json.loads((root/'docs/manifest.json').read_text(encoding='utf-8'))
results=[]
for e in entries:
    pdf=root/'docs/pdf'/f'{e["name"]}.pdf'
    reader=PdfReader(str(pdf))
    result={'name':e['name'],'pages':len(reader.pages),'expected':e['pages'],'sizes':list(set((round(float(p.mediabox.width)),round(float(p.mediabox.height))) for p in reader.pages)),'empty_text_pages':[i+1 for i,p in enumerate(reader.pages) if len(p.extract_text().strip())<30]}
    results.append(result)
    subprocess.run([str(poppler),'-scale-to','1100','-png',str(pdf),str(out/e['name'])],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
    files=sorted(out.glob(e['name']+'-*.png'))
    thumbs=[]
    for file in files:
        img=Image.open(file).convert('RGB');img.thumbnail((530,750))
        tile=Image.new('RGB',(550,790),'#eadbe5');tile.paste(img,((550-img.width)//2,15))
        ImageDraw.Draw(tile).text((15,765),file.stem[-2:],fill='#6b3654');thumbs.append(tile)
    sheet=Image.new('RGB',(1100,790*((len(thumbs)+1)//2)),'#eadbe5')
    for i,img in enumerate(thumbs):sheet.paste(img,((i%2)*550,(i//2)*790))
    sheet.save(out/f'{e["name"]}-contact.jpg')
(root/'docs/assets/pdf-check.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
