# BookerDoc

Školní rezervační systém pro termíny u lékařů. Pacient vybere službu a dostupný začátek,
rezervace se automaticky potvrdí a následně se požádá notifikační služba o e-mail.

## Tým a repozitář

**BookerDoc — 3 členové:**

| Člen | GitHub | Role v C01 změně |
| --- | --- | --- |
| Jan Horák | [ethanjojo](https://github.com/ethanjojo) | Autor změny s asistencí Codexu |
| Štěpán Rychlý | [stepanrychly](https://github.com/stepanrychly) | Člen týmu |
| Daniel Krásný | [DanielKrasny](https://github.com/DanielKrasny) | Reviewer před integrací |

[Společný repozitář](https://github.com/ethanjojo/reservationsystem-swi).
Všichni tři mají podle GitHub collaborators API přístup k zápisu (ověřeno 15. 9. 2026).

## Aktuální stav — CP1

C01 je uzavřený včetně Danielova review a merge. CP1 nyní implementuje runnable cestu
`POST /reservations` → validace → CONFIRMED v PostgreSQL → notifikační stub → HTTP 201.
Databáze chrání před překryvem i při souběžných požadavcích. Lékařova pracovní okna
jsou modelovaná a lokální demo seed vloží služby a pracovní dobu.

Frontend zatím zůstává úvodní stránkou. Formulář, endpoint pro dostupné začátky,
rušení a skutečné e-maily budou v dalších PR. API běží lokálně bez autentizace;
pro CP1 používejte syntetická data.

- [Project Frame a pravidla](docs/intent-and-change.md)
- [Architektura a rozhodnutí](docs/architecture-and-decisions.md)
- [Uzavřená evidence C01 — 15/15 bodů](docs/evidence-and-evolution.md)
- [CP1 specifikace a plán](docs/plans/cp1.md)
- [CP1 evidence](docs/cp1-evidence.md)
- [C01 issue #1](https://github.com/ethanjojo/reservationsystem-swi/issues/1) a [PR #2](https://github.com/ethanjojo/reservationsystem-swi/pull/2)

## Technologie a předpoklady

Node.js **24.x**, npm **11.x**, Docker s pluginem Compose v2 a běžícím enginem.
Přesné JS verze jsou v package-lock.json; používejte `npm ci`.
Prisma 7.10, Express 5, PostgreSQL 17.9, React 19, Vite 8 a shadcn/ui.
TypeScript sdílí jazyk backendu a frontendu; tým si podporu tohoto stacku zajišťuje sám.
Známé výstupy auditu závislostí a jejich limit popisuje [stav závislostí](docs/architecture-and-decisions.md#stav-závislostí-při-c01).

## Spuštění z čistého checkoutu

Příkazy provádějte v kořeni repozitáře. Zkopírujte `.env.example` do `.env` (obsahuje pouze
lokální vývojové přihlašovací údaje). Existující `.env` nepřepisujte.

```bash
npm ci
cp .env.example .env
docker compose up -d --wait
npm run db:generate
npm run db:migrate
npm run db:seed
npm run typecheck
npm test
npm run build
```

`db:migrate` aplikuje verzované migrace do vývojové DB; `npm test` sám aplikuje stejné migrace
pouze do testovací DB a spustí integrační test. Testy používají syntetická data s unikátními UUID a skutečné HTTP/DB scénáře.
V `finally` uklidí jen vlastní data; nepoužívají reset ani mazání všech tabulek.
`db:seed` je pro ruční demo; testy jej nepotřebují a žádný e-mailový účet není potřeba.

V samostatných terminálech:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

API: `http://localhost:3000/health`, odpověď `{"status":"ok","service":"bookerdoc-api"}`.
Web: `http://localhost:5173` (při obsazeném portu viz výpis Vite).
Health endpoint ověřuje běh procesu, nikoli spojení s databází.

Produkční sestavení API lokálně spustíte `npm run start -w @bookerdoc/api`;
web zobrazíte přes `npm run preview -w @bookerdoc/web`.

### Databáze a konfigurace

| Proměnná / služba | Použití |
| --- | --- |
| DATABASE_URL / db | Vývojová DB `bookerdoc`, localhost:55432, persistentní Docker volume |
| TEST_DATABASE_URL / db-test | DB `bookerdoc_test`, localhost:55433, dočasný tmpfs |
| PORT | Express port, výchozí 3000 |

Lokální Compose heslo je pouze pro lokální vývoj; porty DB jsou vázané na 127.0.0.1.
Testovací runner odmítne chybějící URL, jiný název DB nebo stejný DB cíl jako DATABASE_URL.
CLI bere `.env` z kořene projektu; proměnné z prostředí mají přednost (například v CI).

`docker compose stop` zastaví služby. `docker compose down` odstraní kontejnery a testovací data,
ale zachová vývojový volume. Nepřidávejte `--volumes`, pokud chcete zachovat vývojová data.

Na tomto macOS je Docker CLI v `/Applications/Docker.app/Contents/Resources/bin`.
Pokud shell nenajde `docker` nebo `docker-credential-desktop`, přidejte tuto složku do PATH:

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

Pokud porty 55432/55433 používá jiná aplikace, upravte Compose i odpovídající URL v `.env`.

## Struktura

```text
apps/api/src/                  Express, persistence repository, notification port
apps/api/prisma/               Model a verzované migrace
apps/api/tests/                HTTP/DB integrační testy a časová pravidla
apps/web/src/                  React a shadcn komponenty
scripts/test-db.mjs            Bezpečné spuštění migrace a testu nad testovací DB
docs/                         Project Frame, architektura, evidence
.github/workflows/ci.yml       Typy, build a test proti PostgreSQL
```

## CP1 walking skeleton — runnable

Po výše uvedeném spuštění DB, migrací, seedu a API:

```bash
curl -i http://localhost:3000/reservations \
  -H 'Content-Type: application/json' \
  --data '{"patientId":"00000000-0000-4000-8000-000000000001","doctorId":"00000000-0000-4000-8000-000000000002","serviceId":"00000000-0000-4000-8000-000000000003","startsAt":"2030-02-04T09:00:00+01:00"}'
```

Očekává se HTTP **201**:

```json
{
  "id": "vygenerované UUID",
  "status": "CONFIRMED",
  "startsAt": "2030-02-04T08:00:00.000Z",
  "endsAt": "2030-02-04T08:30:00.000Z"
}
```

Demo lékař pracuje pondělí–pátek 08:00–16:00 v Europe/Prague; konzultace trvá 30 minut.
Seed je opakovatelný, již existující demo záznamy ani rezervace nepřepisuje.
Datum požadavku musí být budoucí pracovní den. Opakování stejného požadavku vrátí **409**;
pro druhou platnou rezervaci změňte začátek například na 09:30.

```text
POST /reservations
→ strict UUID/ISO vstup, načíst pacienta, lékaře a jeho službu
→ ověřit budoucí začátek na 15min mřížce od začátku okna
→ vypočítat konec podle délky služby, celý interval musí ležet v jednom okně
→ v transakci uložit CONFIRMED, DB exclusion constraint odmítne překryv
→ po commitu požádat stub o notifikaci
→ HTTP 201 + id/stav/časové okamžiky
→ npm test ověří HTTP odpověď i skutečně uloženou rezervaci
```

Notifikační stub vypíše `notification_stub_accepted` a ID rezervace; e-mail neodesílá
ani neloguje jeho obsah. Selhání stubu vypíše `notification_failed`, rezervace zůstane potvrzená
s HTTP 201. Trvalé retry/outbox a skutečný poskytovatel zatím nejsou implementované.

### HTTP kontrakt

Vstup musí mít přesně patientId, doctorId, serviceId a startsAt (ISO s offsetem/Z, nejvýše 3 desetinná místa sekund).
Začátek musí mít celé minuty; začátky počítáme po 15 minutách od začátku pracovního okna.
Délka služby je 1–1440 uplynulých minut, včetně změn letního času. Intervaly jsou [start,end).

| HTTP | error.code | Příčina |
| --- | --- | --- |
| 201 | — | Potvrzeno a uloženo |
| 400 | INVALID_INPUT | Chybné UUID/ISO/JSON nebo nadbytečná/chybějící pole |
| 400 | START_MUST_BE_FUTURE | Začátek v minulosti nebo právě teď |
| 400 | SERVICE_DOCTOR_MISMATCH | Služba nepatří lékaři |
| 400 | OUTSIDE_WORKING_WINDOW | Čas, délka nebo 15min mřížka nevyhovuje oknu |
| 404 | RESOURCE_NOT_FOUND | Pacient, lékař nebo služba neexistuje |
| 409 | RESERVATION_CONFLICT | Překryv potvrzených rezervací stejného lékaře |
| 413 | PAYLOAD_TOO_LARGE | JSON přes 16 kB |
| 500 | INTERNAL_ERROR | Neočekávaná chyba; interní detail se neposílá klientovi |

### Migrace a souběh

`db:migrate` potřebuje oprávnění vytvořit PostgreSQL extension `btree_gist` (lokální Compose
uživatel je má). Exclusion a CHECK constraints jsou v SQL migraci; Prisma schema je neumí
plně vyjádřit. Používejte migrace, nikoli `prisma db push` jako náhradu.
Pokud už DB obsahuje neplatné intervaly nebo překryvy, nová migrace správně selže;
data se nemažou ani neopravují automaticky. Před migrací opravte nekonzistenci řízeně.

## Change + review smyčka

C01 PR #2 byl schválen Danielem Krásným a integrován do master; odkazy jsou v C01 evidenci.
CP1 se připravuje samostatně ve větvi `codex/cp1-reservation-flow` po malých commitech.
Nový PR opět vyžaduje review jiným členem před merge. Technické review agenta není týmové schválení.
