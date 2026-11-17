const {chromium}=require(process.env.CODEX_NODE_MODULES+'/playwright');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
(async()=>{
 fs.mkdirSync('docs/pdf',{recursive:true});fs.mkdirSync('tmp/docs-qa',{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage({viewport:{width:1280,height:1100},deviceScaleFactor:1});
 const entries=JSON.parse(fs.readFileSync('docs/manifest.json','utf8'));const checks=[];
 for(const name of ['physical','logical']){
   await page.goto(pathToFileURL(path.resolve(`docs/assets/ERD-${name}.svg`)).href);
   await page.locator('svg').screenshot({path:`docs/assets/ERD-${name}.png`});
 }
 for(const entry of entries){
   await page.goto(pathToFileURL(path.resolve(`docs/${entry.name}.html`)).href);await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>[...document.images].every(x=>x.complete));
   const layout=await page.locator('.page').evaluateAll(pages=>pages.map((p,i)=>{
     const footer=p.querySelector('footer').getBoundingClientRect();const rect=p.getBoundingClientRect();
     const nodes=[...p.children].filter(c=>!['HEADER','FOOTER'].includes(c.tagName));
     const bad=nodes.filter(c=>c.getBoundingClientRect().bottom>footer.top-8).map(c=>({tag:c.tagName,text:c.textContent.slice(0,65),bottom:c.getBoundingClientRect().bottom-rect.top,footer:footer.top-rect.top}));
     return {page:i+1,overlaps:bad,horizontal:p.scrollWidth>p.clientWidth,missing:[...p.querySelectorAll('img')].filter(x=>!x.naturalWidth).map(x=>x.src)};
   }));
   checks.push({name:entry.name,layout});
   for(let i=0;i<entry.pages;i++)await page.locator('.page').nth(i).screenshot({path:`tmp/docs-qa/${entry.name}-${String(i+1).padStart(2,'0')}.png`});
   await page.pdf({path:`docs/pdf/${entry.name}.pdf`,format:'A4',landscape:entry.landscape,printBackground:true,margin:{top:0,bottom:0,left:0,right:0},preferCSSPageSize:true});
 }
 fs.writeFileSync('docs/assets/document-check.json',JSON.stringify(checks,null,2));
 console.log(JSON.stringify(checks.map(x=>({name:x.name,pages:x.layout.length,issues:x.layout.filter(p=>p.overlaps.length||p.horizontal||p.missing.length)})),null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
