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
