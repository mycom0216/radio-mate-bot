// 압축 없이 파일을 묶는 간단한 ZIP 만들기입니다. (PNG는 이미 압축된 형식이라 다시 압축해도 크기가 거의 줄지 않습니다)
// 외부 라이브러리 없이 CRC32를 직접 계산하고, 한글 파일 이름이 깨지지 않도록 UTF-8 이름 표시(비트 11)를 켭니다.
const TABLE=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(buffer){let c=0xffffffff;for(const byte of buffer)c=TABLE[(c^byte)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
function dosTime(date){return {time:(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1),date:((Math.max(1980,date.getFullYear())-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()};}
// entries: [{name:'frame01.png', data:Buffer, date?:Date}] → ZIP 파일 내용(Buffer)
export function buildZip(entries,now=new Date()){
  if(!Array.isArray(entries)||!entries.length||entries.length>65000)throw Error('ZIP에 넣을 파일 수가 올바르지 않습니다.');
  const parts=[],central=[];let offset=0;
  for(const entry of entries){
    const name=Buffer.from(String(entry.name),'utf8'),data=Buffer.isBuffer(entry.data)?entry.data:Buffer.from(entry.data),crc=crc32(data),stamp=dosTime(entry.date||now);
    if(data.length>0xfffffffe||name.length>0xffff)throw Error('ZIP에 넣기에는 파일이 너무 큽니다.');
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(0,8);local.writeUInt16LE(stamp.time,10);local.writeUInt16LE(stamp.date,12);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);local.writeUInt16LE(0,28);
    parts.push(local,name,data);
    const head=Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50,0);head.writeUInt16LE(20,4);head.writeUInt16LE(20,6);head.writeUInt16LE(0x0800,8);head.writeUInt16LE(0,10);head.writeUInt16LE(stamp.time,12);head.writeUInt16LE(stamp.date,14);
    head.writeUInt32LE(crc,16);head.writeUInt32LE(data.length,20);head.writeUInt32LE(data.length,24);head.writeUInt16LE(name.length,28);head.writeUInt16LE(0,30);head.writeUInt16LE(0,32);head.writeUInt16LE(0,34);head.writeUInt16LE(0,36);head.writeUInt32LE(0,38);head.writeUInt32LE(offset,42);
    central.push(head,name);
    offset+=30+name.length+data.length;
  }
  const centralSize=central.reduce((sum,part)=>sum+part.length,0),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(0,4);end.writeUInt16LE(0,6);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);end.writeUInt16LE(0,20);
  return Buffer.concat([...parts,...central,end]);
}
