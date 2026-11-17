# Public HTTPS deployment

Requires a Linux server with Docker Compose and a domain you control.
Set the domain A record to the server public IPv4. If you publish an AAAA record,
it must reach this server over IPv6 too. Allow inbound TCP 80/443 and UDP 443.

1. Copy `deploy/https.env.example` to `deploy/https.env`.
2. Set STUDIO_DOMAIN and PUBLIC_URL to matching real values.
3. Generate TOKEN_KEY using the command in the example and keep it with backups.
4. Set Spoon developer credentials and region. Register exactly
   `https://YOUR_DOMAIN/oauth/callback` in the Spoon developer app.
5. From the repository root run:

```sh
docker compose --env-file deploy/https.env -f deploy/compose.https.yaml config --quiet
docker compose --env-file deploy/https.env -f deploy/compose.https.yaml up -d --build
docker compose --env-file deploy/https.env -f deploy/compose.https.yaml ps
curl --fail https://YOUR_DOMAIN/health
```

Caddy obtains and renews the public certificate automatically. Only the proxy
publishes ports; the application is reachable inside the Compose network.
Production mode disables demo login. Actual dashboard login requires Spoon OAuth.
This creates fresh named volumes; it does not migrate the Windows local database.
Back up the studio-data volume (including voice files) and TOKEN_KEY together.
Do not use `down -v` unless you intend to delete persistent data.

To inspect startup failures:

```sh
docker compose --env-file deploy/https.env -f deploy/compose.https.yaml logs --tail=100 studio caddy
```

Configuration provided; public certificate issuance and external connectivity
must be verified after real DNS and server access are available.

## 고정 Cloudflare Tunnel

Cloudflare 계정과 관리 중인 도메인이 있을 때 사용할 수 있습니다.
대시보드에서 원격 관리 터널을 만들고 공개 호스트 이름의 서비스를
`http://studio:4310`으로 설정하세요. 터널 토큰만 `deploy/tunnel-token.txt`에
저장하고 파일 권한을 제한하세요. `deploy/https.env`의 PUBLIC_URL도 해당
고정 HTTPS 주소로 설정하고 스푼 redirect URI를 갱신하세요.

```sh
docker compose -f deploy/compose.tunnel.yaml up -d --build
```

이 구성은 인바운드 포트를 공개하지 않습니다. 서버/PC는 계속 켜져 있어야 합니다.
일반 Caddy 구성과 동시에 실행하지 마세요. 두 방식은 각각 별도 프로젝트로
실행할 경우 같은 데이터에 접근하지 않도록 구성해야 합니다. 고정 주소의 실제
생성에는 Cloudflare 계정과 도메인 설정이 필요합니다.

## 전체 백업 · 복원

서버는 30초 후 및 6시간마다 `data/backups/full-YYYY-MM-DD.rmbak`에 DB와
등록된 음성 파일 전체를 AES-256-GCM 암호화 백업합니다(최근 7개 날짜).
TOKEN_KEY는 별도로 안전하게 보관하세요. 키를 잃으면 복원할 수 없습니다.
다운로드하거나 별도 복사한 백업은 운영자가 수명과 접근 권한을 관리해야 합니다.
현재 형식은 압축 전 JSON 512MB 한도이며, 이를 초과하면 기존 사본을 보존하고
오류를 기록합니다. 더 큰 운영 규모는 별도 스트리밍 백업이 필요합니다.

수동 백업은 서버를 종료하고 실행합니다. 기존 파일을 덮어쓰지 않습니다.

```sh
node --env-file=.env backup.mjs backup data full.rmbak
node --env-file=.env backup.mjs restore full.rmbak data-restored
```

복원 대상은 존재하지 않는 새 폴더여야 합니다. 무결성·음성 파일 일치·키를
확인한 뒤 복원 폴더를 생성합니다. `DATA_DIR=data-restored`로 설정해 시작하세요.
서버 잠금이 있으면 수동 백업을 거부합니다. 백업 당시 토큰이 이후 갱신·폐기됐다면
복원 후 스푼을 다시 연결해야 합니다. 삭제 요청 이후의 과거 백업을 복원할 때는
삭제 요청을 다시 적용하세요. Compose 볼륨은 호스트의 `data/`와 다른 위치이므로
컨테이너를 멈춘 뒤 볼륨 사본을 별도 폴더로 복사하여 사용하세요.
