const { chromium } = require(process.env.CODEX_NODE_MODULES + '/playwright');
const fs = require('node:fs');
let browser;
(async()=>{
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
 fs.mkdirSync('docs/assets',{recursive:true});
 await page.goto('http://localhost:4310');await page.locator('#login').waitFor({state:'visible'});await page.locator('.radio-illustration').waitFor();await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:'docs/assets/01-welcome-desktop.png',fullPage:true});
 const checks=[];
 async function overflow(name){checks.push({name,width:await page.evaluate(()=>innerWidth),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),missingImages:await page.locator('img').evaluateAll(xs=>xs.filter(x=>!x.complete||x.naturalWidth===0).map(x=>x.src))});}
 await overflow('welcome-desktop');await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/assets/02-welcome-mobile.png',fullPage:true});await overflow('welcome-mobile');
 await page.locator('#demo-login').click();await page.locator('#shell').waitFor({state:'visible'});await page.locator('.cute-hero img').waitFor();
 await page.screenshot({path:'docs/assets/04-dashboard-mobile.png',fullPage:true});await overflow('dashboard-mobile');
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'docs/assets/03-dashboard-desktop.png',fullPage:true});await overflow('dashboard-desktop');
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});for(const name of ['games','shop','songs','fans','notices','records','autoChat','voice','settings','test','help']){await page.locator(`nav [data-page="${name}"]`).click();await page.waitForTimeout(80);await overflow(`${name}-${width}`);}}
 await page.locator('nav [data-page="test"]').click();
 await page.locator('#test-form input[name="message"]').fill('!내정보 생성');await page.locator('#test-form button').click();await page.waitForTimeout(250);checks.push({name:'profile-command',success:await page.locator('#chat').textContent().then(t=>/생성|이미/.test(t))});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'docs/assets/05-command-test.png',fullPage:true});
 await page.locator('nav [data-page="voice"]').click();await page.waitForFunction(()=>document.querySelector('#shell').dataset.page==='voice');
 if(await page.locator('[data-voice-link="enable"]').count())await page.locator('[data-voice-link="enable"]').click();
 await page.locator('[data-voice-link="disable"]').waitFor({state:'visible'});
 const voiceUrl=await page.locator('input[aria-label="음성 접수 링크"]').inputValue();
 const voicePage=await page.context().newPage();await voicePage.goto(voiceUrl);await voicePage.locator('#voice-form').waitFor({state:'visible'});
 await voicePage.setViewportSize({width:390,height:844});await voicePage.screenshot({path:'docs/assets/06-voice-mobile.png',fullPage:true});
 checks.push({name:'voice-public-390',overflow:await voicePage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),missingImages:await voicePage.locator('img').evaluateAll(xs=>xs.filter(x=>!x.complete||!x.naturalWidth).map(x=>x.src))});
 await voicePage.close();await page.locator('[data-voice-link="disable"]').click();await page.locator('[data-voice-link="enable"]').waitFor({state:'visible'});
 fs.writeFileSync('docs/assets/ui-check.json',JSON.stringify({errors,checks},null,2));
 console.log(JSON.stringify({errors,checks},null,2));await browser.close();
})().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1});


