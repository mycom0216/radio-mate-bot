// 문서 생성 공통: 블록 모델 → DOCX(docx) + HTML → PDF(Edge). 블록: title meta toc h1 h2 p bul table img pb
import {Document,Packer,Paragraph,TextRun,HeadingLevel,Table,TableRow,TableCell,WidthType,AlignmentType,BorderStyle,ShadingType,ImageRun,PageBreak,Footer,PageNumber,LevelFormat,TableLayoutType} from 'docx';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {dirname,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const FONT='Malgun Gothic',NAVY='2F3E5C',PINK='C2417C';
export const png=p=>{const b=readFileSync(p);return {w:b.readUInt32BE(16),h:b.readUInt32BE(20)};};
const runs=(text,o={})=>{const out=[];for(const part of String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/)){if(!part)continue;const bold=part.startsWith('**'),code=part.startsWith('`');out.push(new TextRun({text:bold?part.slice(2,-2):code?part.slice(1,-1):part,bold:bold||o.bold,font:code?'Consolas':FONT,size:o.size||21,color:o.color}));}return out;};
const para=(text,o={})=>new Paragraph({children:runs(text,o),spacing:{after:o.after??110,line:300},alignment:o.align,keepNext:o.keepNext});
const cell=(text,w,{head,fill,bold}={})=>new TableCell({width:{size:w,type:WidthType.DXA},shading:head?{type:ShadingType.CLEAR,fill:NAVY}:fill?{type:ShadingType.CLEAR,fill}:undefined,margins:{top:50,bottom:50,left:80,right:80},children:String(text).split('\n').map(l=>new Paragraph({children:runs(l,{size:18,bold:head||bold,color:head?'FFFFFF':undefined}),spacing:{after:20}}))});
export async function toDocx(model,out,{title,landscape=false}={}){
 const W=landscape?14400:9500,kids=[];
 for(const b of model){
  if(b.t==='title'){kids.push(new Paragraph({children:[new TextRun({text:b.text,bold:true,size:48,font:FONT,color:NAVY})],spacing:{before:600,after:120}}),new Paragraph({children:[new TextRun({text:b.sub||'',size:24,font:FONT,color:PINK})],spacing:{after:300}}));}
  else if(b.t==='h1')kids.push(new Paragraph({heading:HeadingLevel.HEADING_1,pageBreakBefore:!!b.pb,children:[new TextRun({text:b.text,bold:true,size:32,font:FONT,color:NAVY})],spacing:{before:300,after:140}}));
  else if(b.t==='h2')kids.push(new Paragraph({heading:HeadingLevel.HEADING_2,children:[new TextRun({text:b.text,bold:true,size:25,font:FONT,color:PINK})],spacing:{before:200,after:100},keepNext:true}));
  else if(b.t==='p')kids.push(para(b.text));
  else if(b.t==='bul')for(const i of b.items)kids.push(new Paragraph({numbering:{reference:'b',level:0},children:runs(i),spacing:{after:60,line:290}}));
  else if(b.t==='toc'){kids.push(para('**목차**',{size:26,color:NAVY}));for(const i of b.items)kids.push(para(i,{after:40}));}
  else if(b.t==='meta'||b.t==='table'){const head=b.t==='meta'?null:b.head,rows=b.rows,n=(head||rows[0]).length,ws=b.widths||Array(n).fill(1),sum=ws.reduce((a,c)=>a+c,0),cw=ws.map(x=>Math.floor(W*x/sum));
   if(b.cap)kids.push(para('**'+b.cap+'**',{size:19,after:60,keepNext:true}));
   kids.push(new Table({width:{size:W,type:WidthType.DXA},columnWidths:cw,layout:TableLayoutType.FIXED,borders:{top:{style:BorderStyle.SINGLE,size:4,color:'D1D5DB'},bottom:{style:BorderStyle.SINGLE,size:4,color:'D1D5DB'},left:{style:BorderStyle.SINGLE,size:4,color:'D1D5DB'},right:{style:BorderStyle.SINGLE,size:4,color:'D1D5DB'},insideHorizontal:{style:BorderStyle.SINGLE,size:4,color:'D1D5DB'},insideVertical:{style:BorderStyle.SINGLE,size:4,color:'D1D5DB'}},rows:[...(head?[new TableRow({tableHeader:true,children:head.map((h,i)=>cell(h,cw[i],{head:true}))})]:[]),...rows.map((r,ri)=>new TableRow({cantSplit:true,children:r.map((c,i)=>cell(c,cw[i],{fill:b.t==='meta'&&i===0?'F3E8F0':ri%2&&head?'FAF6F9':undefined,bold:b.t==='meta'&&i===0}))}))]}));kids.push(para('',{after:80}));}
  else if(b.t==='img'){const s=png(b.path),w=Math.min(b.w||600,landscape?900:610),h=Math.round(s.h*w/s.w),mh=landscape?560:760,k=h>mh?mh/h:1;kids.push(new Paragraph({alignment:AlignmentType.CENTER,keepNext:true,children:[new ImageRun({type:'png',data:readFileSync(b.path),transformation:{width:Math.round(w*k),height:Math.round(h*k)},altText:{title:b.cap||'그림',description:b.cap||'그림',name:'img'}})],spacing:{before:80,after:60}}));if(b.cap)kids.push(para(b.cap,{size:18,align:AlignmentType.CENTER,color:'6B7280'}));}
  else if(b.t==='pb')kids.push(new Paragraph({children:[new PageBreak()]}));
 }
 const doc=new Document({title,creator:'라디오메이트',styles:{default:{document:{run:{font:FONT,size:21}}}},numbering:{config:[{reference:'b',levels:[{level:0,format:LevelFormat.BULLET,text:'•',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:500,hanging:250}}}}]}]},sections:[{properties:{page:{size:{width:11906,height:16838,orientation:landscape?'landscape':'portrait'},margin:{top:1100,bottom:1100,left:landscape?1000:1200,right:landscape?1000:1200}}},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:`라디오메이트 · ${title} · `,size:16,font:FONT,color:'888888'}),new TextRun({children:[PageNumber.CURRENT],size:16,color:'888888'}),new TextRun({text:' / ',size:16,color:'888888'}),new TextRun({children:[PageNumber.TOTAL_PAGES],size:16,color:'888888'})]})]})},children:kids}]});
 mkdirSync(dirname(out),{recursive:true});writeFileSync(out,await Packer.toBuffer(doc));
}
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const il=s=>esc(s).replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code>$1</code>');
export function toHtml(model,{title,landscape=false}){
 const o=model.map(b=>{
  if(b.t==='title')return `<h1 class=t>${esc(b.text)}</h1><div class=st>${esc(b.sub||'')}</div>`;
  if(b.t==='h1')return `<h2 ${b.pb?'class=pb':''}>${esc(b.text)}</h2>`;if(b.t==='h2')return `<h3>${esc(b.text)}</h3>`;
  if(b.t==='p')return b.text.split('\n').map(x=>`<p>${il(x)}</p>`).join('');if(b.t==='bul')return `<ul>${b.items.map(i=>`<li>${il(i)}</li>`).join('')}</ul>`;
  if(b.t==='toc')return `<div class=toc><b>목차</b>${b.items.map(i=>`<div>${il(i)}</div>`).join('')}</div>`;
  if(b.t==='meta')return `<table class=m>${b.rows.map(r=>`<tr><th>${il(r[0])}</th><td>${il(r[1])}</td></tr>`).join('')}</table>`;
  if(b.t==='table'){const ws=b.widths||b.head.map(()=>1),s=ws.reduce((a,c)=>a+c,0);return (b.cap?`<div class=cap>${il(b.cap)}</div>`:'')+`<table><colgroup>${ws.map(w=>`<col style="width:${(100*w/s).toFixed(1)}%">`).join('')}</colgroup><thead><tr>${b.head.map(h=>`<th>${il(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r=>`<tr>${r.map(c=>`<td>${il(c).replace(/\n/g,'<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
  if(b.t==='img')return `<figure><img src="${pathToFileURL(resolve(b.path)).href}" style="max-width:${landscape?'100%':'100%'};max-height:${landscape?'118mm':'230mm'}"><figcaption>${esc(b.cap||'')}</figcaption></figure>`;
  if(b.t==='pb')return '<div class=pb></div>';return '';}).join('\n');
 return `<!doctype html><meta charset=utf-8><title>${esc(title)}</title><style>@page{size:A4 ${landscape?'landscape':'portrait'};margin:16mm 15mm}body{font-family:'Malgun Gothic',sans-serif;font-size:10.5pt;line-height:1.55;color:#1F2937}h1.t{color:#2F3E5C;font-size:26pt;margin:30mm 0 4mm}.st{color:#C2417C;font-size:13pt;margin-bottom:10mm}h2{color:#2F3E5C;font-size:16pt;margin:8mm 0 3mm;break-after:avoid}h2.pb,.pb{break-before:page}h3{color:#C2417C;font-size:12.5pt;margin:5mm 0 2mm;break-after:avoid}table{border-collapse:collapse;width:100%;margin:2mm 0 4mm;font-size:9pt;table-layout:fixed}th{background:#2F3E5C;color:#fff;text-align:left}td,th{border:1px solid #D1D5DB;padding:1.5mm 2mm;vertical-align:top;overflow-wrap:anywhere}tr{break-inside:avoid}tbody tr:nth-child(even){background:#FAF6F9}table.m th{background:#F3E8F0;color:#1F2937;width:28%}.cap{font-weight:700;font-size:9.5pt;margin-top:3mm}code{font-family:Consolas,monospace;background:#F3F4F6;padding:0 1mm}figure{margin:3mm 0;text-align:center;break-inside:avoid}figcaption{font-size:9pt;color:#6B7280}.toc div{padding:.4mm 0}</style><body>${o}</body>`;}
export async function htmlToPdf(b,html,pdf,{title,landscape=false}){writeFileSync(html,toHtml(html.model,{title,landscape}));}
export async function buildDoc(browser,{model,title,out,landscape=false}){
 await toDocx(model,out+'.docx',{title,landscape});const html=out.replace(/([^/\\]+)$/,'_pdf_$1')+'.html';writeFileSync(html,toHtml(model,{title,landscape}));
 await browser.go(pathToFileURL(html).href,700);await browser.eval('document.fonts.ready.then(()=>1)');
 const {data}=await browser.send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<div></div>',footerTemplate:`<div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:'Malgun Gothic'">라디오메이트 · ${esc(title)} · <span class="pageNumber"></span> / <span class="totalPages"></span></div>`});
 const pdf=out.replace(/([^/\\]+)$/,'PDF/$1')+'.pdf';mkdirSync(dirname(pdf),{recursive:true});const buf=Buffer.from(data,'base64');writeFileSync(pdf,buf);
 return {pdf,pages:(buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)||[]).length,html};}
