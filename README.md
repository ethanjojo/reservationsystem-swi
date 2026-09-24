# BookerDoc — C02 baseline v0.2

Rezervace termínů u lékařů. Tým: **Jan Horák** ([ethanjojo](https://github.com/ethanjojo)),
**Štěpán Rychlý** ([stepanrychly](https://github.com/stepanrychly)), **Daniel Krásný** ([DanielKrasny](https://github.com/DanielKrasny)).
[Společný repozitář](https://github.com/ethanjojo/reservationsystem-swi).

## Specifikace a schválení

- [Aktuální baseline v0.2, pravidla, požadavky a diagramy](docs/c02/v02.md).
- [Analýza dopadu před změnou](docs/c02/v02-impact.md) a [historická baseline v0.1](docs/c02/v01.md).
- [Evidence C01/C02](docs/evidence-and-evolution.md).
- [Historická CP1 evidence](docs/cp1-evidence.md) a [architektonická rozhodnutí](docs/architecture-and-decisions.md).
- Zadavatel odsouhlasil navrženou politiku; **týmové schválení baseline se provede explicitním review tohoto PR**.

Create ukládá DRAFT. Confirm pro běžného lékaře rovnou potvrzuje, pro lékaře s `requiresApproval` vytvoří PENDING_APPROVAL.
Teprve příslušný lékař může žádost schválit (Approve) nebo odmítnout (Reject). Čekání neblokuje termín.
Platnost končí za 24 hodin od žádosti, nejpozději na začátku termínu. API při čtení nebo změně uchová EXPIRED; časovač není nutný.
Tato verze vědomě mění původní POST kontrakt CP1; staré curl ukázky z CP1 evidence jsou historické.

## Spuštění

Node 24.x, npm 11.x, Docker Compose v2 s běžícím enginem. Stack: Express/Prisma/PostgreSQL + Vite/React/shadcn.

```bash
npm ci
test -f .env || cp .env.example .env
# Existující .env nepřepisujte: doplňte nové DEMO_* proměnné z .env.example.
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm test
npm run typecheck
npm run build
npm run start -w @bookerdoc/api
```

API poslouchá pouze na 127.0.0.1:3000 (lze změnit PORT). Starší proces na portu nejdřív ukončete.
Frontend lze spustit `npm run dev:web`; zůstává statickým skeletonem, C02 se předvádí API.
Na macOS bez Docker v PATH: `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`.
Vývojová DB localhost:55432/bookerdoc; oddělená testovací DB localhost:55433/bookerdoc_test.
Testovací runner hlídá název a odlišný cíl DB, migruje a uklízí jen vlastní syntetická data.
`docker compose down` zachová vývojový volume, testovací tmpfs zanikne; nepřidávejte `--volumes` pro běžné zastavení.
Prisma SQL migrace vynucují CHECK a exclusion constraint; nenahrazujte je `db push`.

## Identita a oprávnění

`.env.example` obsahuje veřejné **lokální demo klíče**, nikoli produkční přihlášení.
DEMO_PATIENT_TOKEN server mapuje na pacienta `00000000-0000-4000-8000-000000000001`,
DEMO_DOCTOR_TOKEN na lékaře `00000000-0000-4000-8000-000000000002`.
Klíče nesmějí být stejné. Chybějící/nesprávný bearer klíč → 401, nesprávná role/vlastník → 403.
Klient nemůže získat oprávnění pouhým zasláním patientId/doctorId ani přepsat serverový čas.

## Reprodukovatelná demonstrace

Ve druhém terminálu se stejnou `.env`:

```bash
npm run demo:c02
# Pro jiný port:
API_BASE_URL=http://localhost:3130 npm run demo:c02
```

Seed nastaví demo lékaři `requiresApproval=true`; noví lékaři mají default false. Skript vyžaduje oba demo tokeny.
Vybere volné pondělí alespoň 48 hodin dopředu, předvede Create/Availability/Confirm/Cancel,
schválení lékařem, odmítnutí, zákaz schválení pacientem a kolizi. Vytvořené řádky zachová jako CANCELLED/REJECTED. Testy navíc ověřují přesnou hranici 24h,
souběh, oprávnění a časové přechody bez čekání reálných hodin. `npm test` spouští skutečné HTTP/DB testy s řízenými hodinami.

## HTTP kontrakt v0.2

Vše kromě `/health` vyžaduje `Authorization: Bearer <demo klíč>`.

| Metoda/cesta | Vstup | Výsledek |
|---|---|---|
| POST /reservations | patientId, doctorId, serviceId, startsAt | 201 DRAFT |
| GET /availability | query doctorId, serviceId, startsAt | 200 available + startsAt/endsAt, beze změny dat |
| GET /reservations/:id | vlastní ID (nebo vlastní lékař) | 200 aktuální rezervace |
| POST /reservations/:id/confirm | prázdné tělo | 200 CONFIRMED nebo PENDING_APPROVAL; 409 kolize/neplatný stav |
| POST /reservations/:id/cancel | prázdné tělo | 200 CANCELLED; 409 pozdní zrušení/neplatný stav/expirace |
| POST /reservations/:id/approve | prázdné tělo, vlastní lékař | 200 CONFIRMED; 403 oprávnění, 409 kolize/stav/expirace |
| POST /reservations/:id/reject | prázdné tělo, vlastní lékař | 200 REJECTED; 403 oprávnění, 409 stav/expirace |

Rezervace v odpovědi: id, status, startsAt, endsAt, approvalRequestedAt, approvalExpiresAt.
Metadata žádosti jsou null před žádostí a při automatickém potvrzení; po rozhodnutí zůstávají pro historii. Intervaly jsou [start,end), čas v ISO s offsetem/Z,
nejvýše 3 desetinná místa; začátek na celé minutě a 15min mřížce relativní k pracovnímu oknu.
Jediným normativním zdrojem politik je [BR-01 až BR-08 ve specifikaci](docs/c02/v02.md).

Další chyby: 400 INVALID_INPUT / START_MUST_BE_FUTURE / SERVICE_DOCTOR_MISMATCH / OUTSIDE_WORKING_WINDOW,
401 UNAUTHORIZED, 403 FORBIDDEN, 404 RESOURCE_NOT_FOUND / RESERVATION_NOT_FOUND,
409 INVALID_STATE / RESERVATION_CONFLICT / CANCELLATION_TOO_LATE / APPROVAL_EXPIRED, 413 PAYLOAD_TOO_LARGE, 500 INTERNAL_ERROR.
Validní availability mimo pracovní okno vrací false. Notifikace po přechodu do CONFIRMED je pouze stub; její chyba potvrzení nevrací.

## Review a omezení

Pořadí navazujících PR: CP1 #4 → v0.1 #5 → toto v0.2 PR. Po sloučení předchozího PR přesměrujte další base na master.
C01 je uzavřený. Snapshoty `c02-v0.1` a `c02-v0.2` zachovávají obě verze; tag nenahrazuje týmové schválení.
Pro spuštění historické v0.1 použijte samostatnou databázi, nikoli downgrade databáze migrované na v0.2.
Produkční autentizace, UI, skutečné e-maily a garance doručení nejsou v rozsahu C02.
Známé auditní položky Prisma z C01 jsou popsané v architektonických rozhodnutích a tímto PR se neřeší.
