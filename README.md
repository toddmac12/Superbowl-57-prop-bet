# Super Bowl Picks: shared games and private participant entries

A Node.js app with built-in SQLite storage. Organizers create separate games for each year, publish invitation links, and enter results. Participants submit remotely through the same hosted server, receive private management links and durable receipts, and can revise entries before the server-enforced deadline.

The original browser-only Super Bowl LVII sheet remains at `/offline.html`. Its previous localStorage key and saved results are unchanged. It is also available through the original `super-bowl.php` entrypoint when using PHP.

## Run locally

Install **Node.js 24 or newer**, stop the previous Python/PHP server on port 5002, then:

```powershell
cd "$HOME\Documents\Superbowl-57-prop-bet"
git pull
npm start
```

Open http://localhost:5002. Runtime uses Node's built-in HTTP/SQLite modules and does not require a separate database installation or `npm install`.

On first run, a private organizer key is generated in `App_Data/organizer-key`. Read it locally:

```powershell
Get-Content .\App_Data\organizer-key
```

Visit http://localhost:5002/organizer and sign in with that key. Keep it private. The key is not a participant invitation. You can instead set `ORGANIZER_KEY` to a private random secret of at least 32 characters; changing it revokes existing organizer sessions on the next start.

## Organizer workflow

1. Create a draft game. Enter the NFL season, title, teams, kickoff, submission deadline, reveal time, named players, and thresholds. The Super Bowl calendar year is stored separately from the NFL season.
2. Review all 25 generated questions and scoring rules. Thresholds are deliberately chosen by the organizer, not advertised as live sportsbook lines.
3. Publish. Questions, player names, thresholds, rules, and all times freeze permanently. Create another game to change the competition after publication.
4. Share the `/game/...` invitation URL. Each normalized display name can have one entry per game (up to 500 entries); this is a name-uniqueness policy, not identity verification.
5. After the deadline, enter outcomes in the result key. Every update requires an explanation and records the old/new answers, source URL, status, timestamp, and result revision. Correcting results recalculates scores without altering submitted picks.
6. For a lost private entry link, independently verify the participant, then issue a replacement from the dashboard. Old links and sessions are revoked. This action never changes their submitted answers.

The deadline cannot be after kickoff. Public reveal cannot be before either the deadline or kickoff. Times are stored as UTC and displayed in each viewer's timezone. The server is authoritative; browser countdowns do not permit late edits. A postponed game retains its original deadline; a cancelled game is void under the frozen rules.

## Participant workflow

Invitation → acknowledge when picks become public → choose a display name → receive a private management link → complete picks → submit → receive a receipt and accepted timestamp.

Keep the private link. Anyone holding it can access that entry. The secret is exchanged for a scoped HttpOnly session and immediately removed from the URL fragment. Sessions last seven days; the private link remains usable until 90 days after reveal unless the organizer replaces it. There is no participant account registration or email recovery in this release.

You may save incomplete drafts and submit revised complete picks before cutoff. **A saved draft does not replace the last accepted submission.** Only a server receipt confirms acceptance. Retried submissions reuse their request ID and receipt; stale revisions from another tab/device are rejected instead of silently overwriting data. Requests definitively rejected for validation can be corrected and resubmitted. If the response is lost, retry the original submission or reload to check the server receipt.

After cutoff, entries are read-only. Names, submitted picks, results, and the leaderboard become public only at reveal. Unsubmitted drafts never appear publicly. Organizer entry lists also hide picks before reveal.

## Hosting for remote participants

`localhost` is only your computer. To accept entries from other locations, deploy this Node app on **one Node 24 process/container with persistent storage**, an HTTPS domain, and a TLS reverse proxy or hosting platform. Static hosting, GitHub Pages, or a Python file server cannot run the shared API.

Set:

- `PUBLIC_ORIGIN=https://your-game-domain.example` — exact origin, no trailing slash. Do not change it to an untrusted incoming Host header.
- `NODE_ENV=production` — startup requires an HTTPS origin.
- `HOST=0.0.0.0` when your host needs the app to listen on its container interface.
- `PORT` as supplied by your host; default is 5002.
- `DATA_DIR` to a private persistent directory; default is `App_Data`.
- Optionally `ORGANIZER_KEY` as a host-managed secret.

Do not expose the backend's plain HTTP port directly to public participants; terminate TLS at the hosting platform/reverse proxy. API cookies become Secure for the configured HTTPS origin. API changes require the matching Origin and a CSRF token. No provider keys, entry secrets, recovery contacts, or database files are served as public assets. Authentication rate limits are process-local; a multi-instance deployment would need a shared database/limiter and is not supported by this SQLite build.

### Docker

```powershell
docker compose up --build -d
```

The supplied compose file binds port 5002 to localhost and uses a named persistent volume. Put it behind HTTPS before sharing with remote participants. Configure the production environment/origin explicitly for a hosted deployment. No hosting account has been provisioned by these code changes.

## Persistence, privacy, and backups

The shared database stores games, frozen question versions, entry drafts/submissions and revisions, hashed access credentials, receipts, sessions, and organizer result history. Private access keys are never stored in plaintext in the database. The organizer bootstrap key is stored in its private key file unless supplied through the host environment. Keep the entire data directory private and out of Git.

Stop the app before backing up `DATA_DIR`, and restore the complete directory to preserve games and organizer access. Do not delete it when updating the app.

The old LVII browser sheet is not automatically uploaded into the shared database. Open **Previous local LVII sheet** on the same browser/origin to retain those results and export its JSON backup. A different protocol/domain/port is a different browser-storage origin. Keep legacy JSON backups when changing hosts.

## Annual setup and result-feed scope

This release implements yearly game separation, reviewed question generation, shared participant submissions, and manual audited results. **Automatic matchup/roster discovery, unattended annual scheduling, verified sports-data settlement, and email delivery are not connected.** No data provider or paid service is assumed. A later updater can feed the versioned public game/results model, but must preserve frozen questions, private entries, manual overrides, and sourced corrections.

## Test

```powershell
npm ci --ignore-scripts
npm run check
npm test
```

Tests use isolated temporary databases and in-process HTTP servers. They cover legacy scoring/storage, yearly isolation, question freezing, required picks, draft/final separation, deadline boundaries, atomic receipts, idempotent and lost-response retries, stale revisions, Origin/CSRF, private scopes, reveal restrictions, link rotation/expiry, UTF-8 request chunks, persistence after restart, and real DOM-plus-HTTP participant/organizer flows. GitHub Actions also checks the PHP legacy entrypoint.

### Free Cloudflare hosting for picks.commcrae.com

The Cloudflare deployment uses a Worker plus **SQLite-backed Durable Objects**, available on Workers Free. The database is built into the hosted app; no local computer or separate database server is needed. One durable object holds the shared games database so synchronous SQLite transactions preserve deadline, revision, and receipt checks. This is an alternative deployment target; `npm start` still uses local Node/SQLite. It does not migrate an existing local database automatically.

1. Run `npm ci`, `npm run check`, `npm test`, and `npm run test:cloudflare` (a real local workerd/SQLite integration test).
2. Sign in using `npx wrangler login` on your computer. Keep the Cloudflare account on **Workers Free**; do not upgrade to a paid plan for this setup.
3. Create a random organizer key of at least 32 characters using a password manager. Store it privately, then run `npx wrangler secret put ORGANIZER_KEY` and enter it at the private prompt. Never commit it or enter it into chat. This creates an app secret, not a Cloudflare account API token.
4. Run `npm run cloudflare:deploy`. The build copies only the seven public assets to `cloudflare/public`; server source, data files, environment files, and keys are excluded. Workers receives a SQLite Durable Object binding automatically through the configuration migration. Do not remove/rename the `PicksStore` class, namespace binding, or `shared-games-v1` object name after launch without a data migration.
5. Add `commcrae.com` as a Free Cloudflare zone. Before changing the Squarespace nameservers, compare the **complete existing DNS records** with the imported zone: preserve all Google Workspace MX records, SPF, DKIM, DMARC, verification records, and any other service records. Automatic scans can miss records, especially DKIM selector records. Keep the domain registered/renewed at Squarespace. Do not disable DNSSEC without following the provider's migration procedure; a stale registrar DS record can prevent resolution after a nameserver change.
6. Once the zone is active, open the Worker → Settings → Domains & Routes → Add → Custom Domain and enter `picks.commcrae.com`. Cloudflare manages its DNS and HTTPS certificate. `PUBLIC_ORIGIN` in `wrangler.jsonc` already matches this exact origin. The default workers.dev address intentionally returns 404 to prevent alternate-origin session/access links; to test it before the domain is ready, temporarily set `PUBLIC_ORIGIN` to that exact HTTPS address and redeploy, then restore the custom origin before inviting participants.
7. Check the game page and organizer sign-in over HTTPS, create a test game, join from a separate phone/browser, submit picks, reload the receipt, and verify Google Workspace can still send/receive email. Only then share invitations.

Free hosting has usage caps, not unlimited capacity. Cloudflare currently documents 100,000 Worker requests/day, 100,000 Durable Object requests/day, 13,000 GB-s Durable Object duration/day, 5 million SQLite rows read/day, 100,000 rows written/day, and 5 GB total SQLite storage. Index updates can count as additional writes. On Workers Free, exceeding a limit causes relevant operations to fail until reset (or storage cleanup); this setup does not require a paid subscription. Monitor usage before game day. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

The organizer key is required as a Cloudflare secret. Rotating it invalidates previous organizer sessions when the updated deployment initializes the database handler. SQLite data survives deployments and idle periods. Use Cloudflare's SQLite Durable Object recovery/bookmark tooling for recovery; do not delete its namespace to redeploy. There is no automatic database export or cross-host migration UI in this version.

The domain is not connected and the app is not live merely by merging this code: Cloudflare account authentication, the secret, deployment, DNS verification, and custom-domain activation must be completed. Annual sports feeds and email recovery remain unconnected.
