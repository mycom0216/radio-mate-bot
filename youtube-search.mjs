export class YouTubeSearch {
  constructor({key='',fetcher=fetch,now=Date.now}={}){Object.assign(this,{key,fetcher,now});this.cache=new Map();this.pending=new Map();}
  async find(query){
    query=String(query).trim();if(!query||query.length>150)throw Error('곡 제목은 1~150자로 입력하세요.');
    if(!this.key)throw Error('제목 자동 검색에는 서버의 YOUTUBE_API_KEY 설정이 필요합니다. YouTube에서 곡을 검색한 뒤 영상 링크를 연결해 주세요.');
    const cached=this.cache.get(query);if(cached&&cached.expires>this.now())return cached.id;
    if(this.pending.has(query))return this.pending.get(query);
    const task=(async()=>{
      const params=new URLSearchParams({part:'snippet',type:'video',q:query,maxResults:'1',videoEmbeddable:'true',videoSyndicated:'true'});
      const res=await this.fetcher(`https://www.googleapis.com/youtube/v3/search?${params}`,{headers:{'X-Goog-Api-Key':this.key},signal:AbortSignal.timeout(10000)});
      if(!res.ok)throw Error(res.status===403?'YouTube 검색 권한 또는 일일 한도를 확인하세요. 영상 링크로도 연결할 수 있습니다.':'YouTube 검색에 실패했습니다. 잠시 후 다시 시도하거나 영상 링크를 연결하세요.');
      const id=(await res.json()).items?.[0]?.id?.videoId;
      if(!/^[\w-]{11}$/.test(id||''))throw Error('재생 가능한 검색 결과가 없습니다. 영상 링크를 직접 연결하세요.');
      if(this.cache.size>=500)this.cache.delete(this.cache.keys().next().value);
      this.cache.set(query,{id,expires:this.now()+3600000});return id;
    })();this.pending.set(query,task);try{return await task;}finally{this.pending.delete(query);}
  }
}
