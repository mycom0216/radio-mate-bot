export function diagnosticsHTML(data,esc){
 const button='<button type="button" class="secondary" data-action="diagnostics-refresh">운영 상태 확인</button>';
 if(!data)return `<p class="small">계정 연결·방송 상태·조용 모드·보상 정책·백업을 한 번에 점검하세요. 설정은 변경하지 않습니다.</p>${button}`;
 return `<p class="small">마지막 확인: ${esc(new Date(data.checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))} · 아래는 확인 시점의 상태입니다.</p><div class="diagnostic-list">${data.checks.map(check=>`<div class="diagnostic-item ${esc(check.status)}"><span class="pill ${check.status==='warn'?'diagnostic-warning':''}">${check.status==='pass'?'확인':check.status==='warn'?'확인 필요':'안내'}</span><div><strong>${esc(check.title)}</strong><p class="small">${esc(check.detail)}</p></div></div>`).join('')}</div>${button}`;
}
