import {createServer} from 'node:http';
const target=new URL(process.env.PUBLIC_URL||'');
if(target.protocol!=='https:')throw Error('공용 HTTPS 주소가 필요합니다.');
createServer((req,res)=>{
  const path=/^\/(?:voice\/[a-f0-9]{64}|v\/[A-Za-z0-9_-]{43})$/.test(req.url||'')?req.url:'/';
  res.writeHead(302,{Location:target.origin+path, 'Cache-Control':'no-store'});res.end();
}).listen(4310,'127.0.0.1',()=>console.log('Local dashboard redirects to public HTTPS.'));
