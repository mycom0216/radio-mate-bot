export function buildDiagnostics({demo,configured,hasToken,room,backups=0,logs=[],now=Date.now(),publicUrl=''}){
 let publicHttps=false;try{const url=new URL(publicUrl);publicHttps=url.protocol==='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname);}catch{}
 const checks=[
  {id:'mode',status:demo?'info':'pass',title:demo?'지금은 로컬 연습 공간이에요':'DJ 방송 관리 공간이에요',detail:demo?'여기서 실행한 테스트 명령은 실제 스푼 채팅에 전송되지 않습니다.':'연결 동의한 방송의 상태를 확인합니다.'},
  {id:'account',status:configured&&hasToken?'pass':demo?'info':'warn',title:configured&&hasToken?'스푼 연결 동의 정보가 저장되어 있어요':'스푼 연결 준비가 필요해요',detail:configured&&hasToken?'저장 여부를 확인했습니다. 실제 토큰 갱신과 채팅 송신 성공은 방송에서 별도 확인하세요.':demo?'연습은 바로 사용할 수 있습니다. 실방송에는 개발자 앱 설정과 DJ 계정 동의가 필요합니다.':'개발자 앱 설정과 DJ 계정 연결을 확인해 주세요.'},
  {id:'live',status:room.live?'pass':'info',title:room.live?'방송 이벤트를 수신 중이에요':'현재 연결된 실방송이 없어요',detail:room.live?'실제 채팅 수신·전송은 연결 상태와 권한에 따라 달라집니다.':'방송 시작과 연결 상태를 확인하세요. 연습 모드에서는 정상적인 상태입니다.'},
  {id:'quiet',status:room.settings.quiet?'warn':'pass',title:room.settings.quiet?'조용 모드가 켜져 있어요':'게임·자동 안내가 응답할 수 있는 설정이에요',detail:room.settings.quiet?'게임 명령과 주기 안내가 멈춥니다. 필요할 때 조용 모드를 해제하세요.':'개별 게임의 ON/OFF와 개인 대기시간은 별도로 적용됩니다.'},
  {id:'golden',status:room.settings.fishing&&room.settings.goldenPolicy==='pending'?'warn':'info',title:room.settings.goldenPolicy==='pending'?'황금주사위 보상 정책이 보류 상태예요':'황금주사위 보상 한도 정책이 선택되어 있어요',detail:room.settings.goldenPolicy==='pending'?'해당 물고기를 잡아도 보상은 자동 지급되지 않습니다. 게임 설정에서 정책을 확인하세요.':'선택한 낚시·전체 PT 한도에 따라 처리됩니다.'},
  {id:'public',status:publicHttps?'pass':'info',title:publicHttps?'공유용 주소가 HTTPS로 설정되어 있어요':'다른 기기에서 쓸 공유 주소가 필요해요',detail:publicHttps?'주소 형식만 확인했습니다. 실제 외부 접속과 마이크 동작은 별도 확인이 필요합니다.':'localhost 접수 링크는 같은 PC에서만 쓸 수 있습니다. 외부 접수에는 공용 HTTPS가 필요합니다.'},
  {id:'backups',status:backups?'pass':'info',title:backups?`설정 백업 ${backups}개가 있어요`:'아직 설정 백업이 없어요',detail:'설정 백업에는 청취자 잔액과 음성 파일이 포함되지 않습니다. 전체 복구에는 별도 데이터 백업이 필요합니다.'}
 ];
 const failures=logs.filter(l=>l.type==='chat-send-failed'&&l.time>=now-86400000).length;
 checks.push({id:'delivery',status:failures?'warn':'info',title:failures?`최근 기록에서 전송 실패 ${failures}건을 확인했어요`:'최근 기록에서 채팅 전송 실패를 찾지 못했어요',detail:'최근 200개 활동 기록 중 24시간 이내 건을 확인합니다. 실패가 없다는 사실만으로 실방송 검증 완료를 뜻하지는 않습니다.'});
 return {checkedAt:now,checks};
}
