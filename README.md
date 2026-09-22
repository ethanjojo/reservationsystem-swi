# BookerDoc — C02 baseline v0.1

Rezervace termínů u lékařů. Tým: **Jan Horák** ([ethanjojo](https://github.com/ethanjojo)),
**Štěpán Rychlý** ([stepanrychly](https://github.com/stepanrychly)), **Daniel Krásný** ([DanielKrasny](https://github.com/DanielKrasny)).
[Společný repozitář](https://github.com/ethanjojo/reservationsystem-swi).

## Specifikace a schválení

- [Úplná baseline v0.1, pravidla, přijetí požadavků a diagramy](docs/c02/v01.md).
- [Evidence C01/C02](docs/evidence-and-evolution.md).
- [Historická CP1 evidence](docs/cp1-evidence.md) a [architektonická rozhodnutí](docs/architecture-and-decisions.md).
- Zadavatel odsouhlasil navrženou politiku; **týmové schválení baseline se provede explicitním review tohoto PR**.

C02 odděluje Create (DRAFT) a Confirm (CONFIRMED). DRAFT neblokuje čas a Create ignoruje kolize.
Automatické objednání = dvě po sobě jdoucí operace bez lidského schvalování, ne samostatná operace Approve.
Tato verze vědomě mění původní POST kontrakt CP1; staré curl ukázky z CP1 evidence jsou historické.

## Spuštění

Node 24.x, npm 11.x, Docker Compose v2 s běžícím enginem. Stack: Express/Prisma/PostgreSQL + Vite/React/shadcn.

```bash
npm ci
cp .env.example .env
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

Skript vybere volný termín následujícího pondělí, předvede úspěšné i negativní Create/Availability/Confirm/Cancel,
ukáže kolizi a uvolnění času. Vytvořené řádky nakonec zruší a zachová historii. Testy navíc ověřují přesnou hranici 24h,
souběh, oprávnění a časové přechody bez čekání reálných hodin. `npm test` spouští skutečné HTTP/DB testy s řízenými hodinami.

## HTTP kontrakt v0.1

Vše kromě `/health` vyžaduje `Authorization: Bearer <demo klíč>`.

| Metoda/cesta | Vstup | Výsledek |
|---|---|---|
| POST /reservations | patientId, doctorId, serviceId, startsAt | 201 DRAFT |
| GET /availability | query doctorId, serviceId, startsAt | 200 available + startsAt/endsAt, beze změny dat |
| GET /reservations/:id | vlastní ID (nebo vlastní lékař) | 200 aktuální rezervace |
| POST /reservations/:id/confirm | prázdné tělo | 200 CONFIRMED; 409 kolize/neplatný stav |
| POST /reservations/:id/cancel | prázdné tělo | 200 CANCELLED; 409 pozdní zrušení |

Rezervace v odpovědi: id, status, startsAt, endsAt. Intervaly jsou [start,end), čas v ISO s offsetem/Z,
nejvýše 3 desetinná místa; začátek na celé minutě a 15min mřížce relativní k pracovnímu oknu.
Jediným normativním zdrojem politik je [BR-01 až BR-07 ve specifikaci](docs/c02/v01.md).

Další chyby: 400 INVALID_INPUT / START_MUST_BE_FUTURE / SERVICE_DOCTOR_MISMATCH / OUTSIDE_WORKING_WINDOW,
401 UNAUTHORIZED, 403 FORBIDDEN, 404 RESOURCE_NOT_FOUND / RESERVATION_NOT_FOUND,
409 INVALID_STATE / RESERVATION_CONFLICT / CANCELLATION_TOO_LATE, 413 PAYLOAD_TOO_LARGE, 500 INTERNAL_ERROR.
Validní availability mimo pracovní okno vrací false. Notifikace po Confirm je pouze stub; její chyba potvrzení nevrací.

## Review a omezení

PR v0.1 navazuje na otevřené CP1 PR #4. Nejprve integrujte CP1, potom v0.1; následné v0.2 bude mít samostatný diff.
C01 je uzavřený, znovu ho nevytváříme. Baseline v0.1 bude zachována tagem `c02-v0.1`; tag značí reprodukovatelnou verzi aplikace, ne fingované schválení týmem.
Produkční autentizace, UI, skutečné e-maily a garance doručení nejsou v rozsahu C02.
Známé auditní položky Prisma z C01 jsou popsané v architektonických rozhodnutích a tímto PR se neřeší.
