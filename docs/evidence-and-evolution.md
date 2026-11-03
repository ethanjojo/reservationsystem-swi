# C01 Engineering Spike

## Question / unknown
Dokážeme s Prisma 7 a pg adaptérem uložit rezervaci do skutečného PostgreSQL a po odpojení
zapisujícího klienta načíst druhým klientem identitu, vazby, stav a přesné časové okamžiky?

## What we did
- Dne 15. 9. 2026 na macOS arm64, Node 24.19.0, npm 11.17.0 a Docker Desktop 4.44.3
  jsme spustili PostgreSQL 17.9 (`postgres:17.9-alpine`).
- Vytvořili jsme Prisma schéma a migraci `20260915114039_initial_persistence`.
- Použili jsme samostatnou DB `bookerdoc_test` na portu 55433; vývojová DB je na 55432.
- Integrační test vytvořil syntetického pacienta, lékaře a službu. Nejprve běžel proti
  neimplementovanému repository a selhal na očekávané chybě.
- Doplnili jsme skutečný create/findById přes Prisma; zopakovali stejný test.
- Test uložil CONFIRMED rezervaci na 4. 2. 2030, 09:00:00.123–09:30:00.123 +01:00,
  odpojil zapisujícího klienta a použil nový klient pro načtení.
- Ověřil všechny uložené hodnoty, UTC reprezentaci, neexistující ID a neměnnost termínu
  při změně délky služby. Nakonec uklidil pouze vlastní data.

## Observed result
**Spike A byl skutečně proveden a prošel: 1 integrační test, 1 passed, exit code 0.**
Před implementací stejný test skončil 1 failed s `Reservation persistence is not implemented`.
Časy se načetly jako `2030-02-04T08:00:00.123Z` a `2030-02-04T08:30:00.123Z`.
Změna služby z 30 na 45 minut neposunula existující rezervaci.

Evidence výstupů (odstraněny pouze prázdné koncové řádky):
- [RED: test před implementací](evidence/persistence-red.txt)
- [GREEN: test po implementaci](evidence/persistence-green.txt)

Příkazy k reprodukci jsou v README. `npm test` generuje klienta, nasadí migraci
na TEST_DATABASE_URL a provede skutečný test. RED výpis zachycuje mezistav před implementací;
aktuální větev má již funkční repository.

## Decision / what changes because of the result
Prisma 7 + pg adapter + PostgreSQL zůstávají zvolenou persistence vrstvou pro CP1.
Budeme používat verzované migrace a ukládat konkrétní startsAt/endsAt jako timestamptz(3).
Z výsledku plyne, že základní round-trip a milisekundová přesnost pro tento scénář fungují.
Neprokazuje to ochranu souběžných rezervací, pracovní okna, pravidlo zrušení ani doručení e-mailu.
Tyto části nejsou předmětem C01 spiku a musí dostat vlastní implementaci a kontroly v dalších týdnech.

## Change + review evidence
- Tým: **BookerDoc**, 3 členové s přístupem k zápisu (viz README).
- Task: [C01 engineering spike #1](https://github.com/ethanjojo/reservationsystem-swi/issues/1).
- Autor: Jan Horák (`ethanjojo`) s asistencí Codexu.
- Větev: `codex/c01-engineering-spike` → cílová větev `master`.
- Reviewer: Daniel Krásný (`DanielKrasny`), review request odeslán.
- Pull request: [C01 BookerDoc #2](https://github.com/ethanjojo/reservationsystem-swi/pull/2).
- Stav: Daniel Krásný změnu schválil 15. 9. 2026 v 11:58:28 UTC a PR byl mergnut v 11:58:41 UTC.
- [Skutečné Danielovo schválení](https://github.com/ethanjojo/reservationsystem-swi/pull/2#pullrequestreview-5209635261).
- [Merge commit 77420bc](https://github.com/ethanjojo/reservationsystem-swi/commit/77420bcf074dba6b91bafc7965931ddc90f670ed).

## Definition of Done před C02

| # | Požadavek | Stav / evidence |
| --- | --- | --- |
| 1 | Tým 3–4 členové | Splněno: BookerDoc, 3 GitHub účty v README |
| 2 | Společné repo | Splněno: GitHub repo, všichni mají write přístup |
| 3 | Jasný reservation domain | Definováno: termíny a služby u lékařů |
| 4 | Resource + Reservation + User | Definováno a minimálně modelováno v Prisma |
| 5 | Meaningful states | Definováno: DRAFT / CONFIRMED / CANCELLED |
| 6 | Create + confirm + cancel + availability | Definováno v Project Frame; implementace až další etapy |
| 7 | Common overlap rule | Definováno včetně hranic intervalů a návrhu ochrany souběhu |
| 8 | 1 domain-specific rule | Definováno: zrušení nejpozději 24 hodin před začátkem |
| 9 | 1 boundary | Definováno: Notification Service + TypeScript port |
| 10 | Kompletní Project Frame | Splněno: intent-and-change.md |
| 11 | 1 Q/C/R/L pressure | Definováno: C — výjimky z pracovních oken |
| 12 | Reviewed and integrated change | Splněno: Danielovo APPROVED a merge PR #2 (odkazy výše) |
| 13 | 1 executed engineering spike | Splněno: spike A, reálný PostgreSQL test |
| 14 | Spike evidence + decision | Splněno: tento dokument + RED/GREEN výpisy |
| 15 | Definovaný CP1 walking skeleton | Definováno v README; runnable až po C03 / před C04 |

C01 je uzavřený: všech 15 bodů je splněno. Týmová review smyčka je doložena skutečným schválením a merge.

## Doplňkové ověření skeletonu
- `npm run typecheck` a `npm run build`: úspěch pro obě workspaces.
- Sestavené API: GET /health vrátil HTTP 200 a `{"status":"ok","service":"bookerdoc-api"}`.
- UI: Playwright Chromium, desktop 1280×800 a mobil 390×844, `http://127.0.0.1:5173/`.
  Ověřen titulek BookerDoc, hlavní nadpis, neprázdná stránka, žádný Vite overlay,
  žádný horizontální přetok a nula chyb konzole/stránky. Screenshoty byly vizuálně zkontrolovány.
  Stránka je statická a neobsahuje interaktivní rezervační ovládání.
- Browser plugin nebyl dostupný; použit existující Playwright z lokálního runtime,
  bez přidávání testovacího prohlížeče do závislostí projektu.
- Technická kontrola agentem nenašla funkční blokery; opravili jsme neaktuální checkboxy plánu.
  Nejedná se o požadované review druhým členem týmu.
- Čistá reinstalace `npm ci` prošla; po ní znovu prošly `npm test`, `npm run typecheck`
  a `npm run build`. Nebyl to clean checkout druhým členem, proto nejde o spike C.
- Závislosti: audit hlásí 4 high položky; přesný řetězec, doporučení a limit jsou
  uvedeny v [architektonických rozhodnutích](architecture-and-decisions.md#stav-závislostí-při-c01).


## C02 — baseline v0.1 (2026-09-22)

### Přijatý baseline

Normativní zadání: [v0.1](c02/v01.md). Vlastník schválil návrh chování v konverzaci. **Schválení celým týmem čeká na skutečné review PR**; implementace ani tag toto schválení nenahrazují. Reprodukovatelný snapshot: tag `c02-v0.1`.

### Předvedené operace a skutečné příklady

Spuštěno proti PostgreSQL 17.9: `npm test` — **45 testů prošlo**; `npm run typecheck` a `npm run build` prošly. [Výstup testů](evidence/c02-v01-tests.txt). Následně spuštěno `npm run demo:c02` proti běžícímu API na portu 3130: [HTTP výstup](evidence/c02-v01-demo.txt).

| Operace | Úspěšný příklad | Negativní / hraniční příklad |
| --- | --- | --- |
| Create | 201 DRAFT, uložená rezervace | 400 neúplný vstup; 403 cizí pacient |
| Availability | 200 true po vytvoření draftu a po zrušení | 200 false po potvrzení; 400 neplatný čas |
| Confirm | 200 CONFIRMED a následná notifikace | 409 překryv, draft zůstává; dva souběžné požadavky potvrdí nejvýše jeden |
| Cancel | 200 CANCELLED, uchovaný řádek; opakování 200 | přesně 24 h dovoleno, o 1 ms později 409; neexistující ID 404 |

HTTP ukázka běží s reálným časem a uklízí vytvořené rezervace zrušením. Přesné časové hranice a souběh ověřují integrační testy s injektovanými hodinami, nikoli veřejným API pro změnu času.

### Rozdíly a jejich řešení

CP1 vytvářel rovnou potvrzenou rezervaci. C02 vyžaduje oddělené Create a Confirm: kontrakt byl vědomě změněn na DRAFT → CONFIRMED. Uživatelské automatické potvrzení lze složit ze dvou volání. Identita pacienta se ověřuje serverovou mapou demo tokenů, nikoli pouze ID z těla. Staré dokumenty jsou označené jako historické.

Při ověření byl nejprve vypnutý Docker; po spuštění databází testy fungují. Pro ověření regresí byly dočasně vráceny oba staré aplikační soubory: 14 testů selhalo, po obnovení implementace všech 45 prošlo. Původní chování tedy nová sada rozlišuje.

### Dopad, nejistoty a vstupy pro C03

Další změna schvalování bude analyzována samostatně před úpravou baseline. Otevřené zůstávají produkční přihlášení, skutečné doručení emailů, úpravy pracovních oken za provozu a klientský rezervační formulář. Aktuální frontend je demonstrační; všechny požadované operace jsou spustitelné přes API.

C03 drivers: atomické přidělení výlučného zdroje (DB exclusion constraint), serializace změn jedné rezervace (row lock), jednotný serverový čas a časové pásmo, oddělení trvalého stavu od selhání notifikace, důvěryhodná identita aktéra. Outbox, autentizace a plánování změn kalendáře jsou kandidáti dalšího návrhu, nikoli již dodané funkce.


## Evidence C02: specifikace → běžící aplikace

### Přijatá baseline

[v0.1](c02/v01.md) zachovává čtyři samostatné operace. Aktuální [v0.2](c02/v02.md) přidává schvalování. Produktový návrh odsouhlasil vlastník; **explicitní týmové schválení obou baseline je stále PENDING a musí být doloženo review PR**. Autorská akceptační tabulka a automatické testy nenahrazují odpovědnost členů týmu.

### Předvedené základní operace a skutečně provedené příklady ověření

Dne 2026-09-22: PostgreSQL 17.9, Node 24.19.0. V0.1: 45 úspěšných testů a skutečná HTTP demonstrace popsaná výše. V0.2: **61 úspěšných testů**, typecheck a build; [výstup v0.2 testů](evidence/c02-v02-tests.txt). Lokální API na portu 3131 prošlo `npm run demo:c02`: [výstup HTTP demonstrace](evidence/c02-v02-demo.txt).

| Chování | Skutečně ověřený úspěch | Negativní/hraniční výsledek |
| --- | --- | --- |
| Create | 201 DRAFT i pro schvalovaný zdroj | 400 neplatný vstup; 403 cizí identita |
| Availability | true pro DRAFT i čekání, false po schválení, true po zrušení | 400 neplatný čas; sousedící interval nekolizní |
| Confirm | běžný zdroj CONFIRMED; schvalovaný PENDING_APPROVAL s deadline | 409 opakování; kolize automatického potvrzení zachová DRAFT |
| Cancel | čekání i méně než 24h před termínem → CANCELLED | potvrzené přesně 24h ano, o 1ms později 409; EXPIRED/REJECTED nelze oživit |
| Approve | vlastní lékař, i s hodinovým zpožděním → CONFIRMED | pacient/jiný lékař 403; dva konfliktní Approve → jeden úspěch, druhý 409 a stále čeká |
| Reject | REJECTED, uchování a čtení pacientem, žádná alokace | opakování či jiný aktér odmítnut; následné Approve 409 |
| Expire | 1ms před deadline čekání, přesně na deadline EXPIRED | všechny čtyři mutace po deadline 409 a expirace přesto commitnutá |
| Souběh a trvalost | Approve/Cancel a Approve/Reject mají sekvenční výsledek | skutečný PostgreSQL lock zadrží Approve; čas se posune na deadline, po uvolnění 409 EXPIRED |

Nová instance aplikace čte lhůtu z DB, neobnovuje ji. Expirace se předvádí skutečnými integračními HTTP testy s řízeným serverovým časem; živé demo nečeká 24 hodin. API nepřijímá klientský čas. Čekání, odmítnutí i vypršení ponechávají dostupnost volnou.

### Nalezený nesoulad a způsob vyřešení

Před implementací nová sada ukázala 16 selhání: 15 chybějících schvalovacích scénářů a jeden původní persistence test s očekáváním bez nových nullable polí. Doplněny byly stavové operace a odpověď API; persistence očekávání nyní výslovně kontroluje null metadata automatické rezervace. Původní pravidla pro běžné zdroje zůstala ověřena.

Expirace při odmítnuté mutaci nesmí být vrácena rollbackem. Implementace proto nejdříve uloží EXPIRED a commitne, teprve poté vrátí doménovou chybu; integrační testy kontrolují i skutečný uložený stav. Při závěrečné autorské kontrole byla opravena chybná čísla BR odkazů v dopadové tabulce; týmový review tím není nahrazen.

### Shrnutí dopadu změny

Analýza dopadu je samostatný commit `dfcba90`, před specifikací v0.2 (`deaddd4`) a implementací (`746cfc7`). [Dopadový dokument](c02/v02-impact.md) identifikuje dotčené i nedotčené požadavky. Create se nemění; Availability dál blokuje jen CONFIRMED. Confirm větví podle zdroje; nové Approve/Reject rozhodují čekající žádost. Cancel rozlišuje čekání a potvrzenou alokaci. Stavový model, oprávnění a diagramy zachycují tři nové stavy. Migrace pouze přidává pole/hodnoty, existující lékaři mají default false a rezervace zůstávají zachované. Lokální demo seed výslovně přepíná demo lékaře na schvalování.

### Zbývající předpoklad / neznámá

Tým musí schválit politiku neblokujícího čekání a platnosti min(24h, začátek termínu). Produkční přihlášení, reálné emaily, klientský formulář, delegování schvalovatele a souběžná editace pracovních oken jsou mimo tento checkpoint. Fyzický DB stav bez interakce může zůstat PENDING_APPROVAL; API vždy vyhodnocuje deadline a vrací aktuální logický stav. Neexistuje proaktivní expiry zpráva ani garantované doručení emailu.

### Architektonické drivery přenesené do C03

1. Trvalý odložený proces: žádost a deadline přežijí proces; rozhodnutí musí zohlednit čas i po čekání na zámek.
2. Konzistentní alokace: dvě čekající žádosti mohou být platné, ale potvrzená kapacita musí být výlučná i v souběhu.
3. Pozorovatelná expirace versus reporting: on-access materializace stačí pro dnešní API; hromadné reporty a notifikace mohou vyžadovat job.
4. Oprávnění spojená se zdrojem a pacientem: demo mapu v budoucnu nahradí skutečný autentizační mechanismus.
5. Oddělené doručení notifikace: stav rezervace přežije chybu odeslání; garance doručení by vyžadovala outbox/retry návrh.

### Commit / tag aplikace

- `c02-v0.1`: samostatné čtyři operace, PR [#5](https://github.com/ethanjojo/reservationsystem-swi/pull/5), navazuje na CP1 #4.
- `c02-v0.2`: schvalování, odmítnutí, expirace, rozšířené testy a tato evidence; navazující PR má base v0.1.

Tagy jsou reprodukovatelné snapshoty, nikoli záznamy týmového schválení. Před C03 zbývá skutečné týmové review specifikace a následné sloučení PR ve správném pořadí.

## C03 — Architecture Evidence

**Baseline:** [Specification Baseline v0.2](c02/v02.md) — beze změny pozorovatelného kontraktu.

**Part A:** [AS-IS realizace Confirm → Approve](architecture-and-decisions.md#c03-část-a--as-is-realizace-scénáře-approve-reservation)
(mapování kroků na kód, větev kolize, stav/pravidlo BR-02, závislosti, AS-IS diagram). Nález: notifikaci posílá HTTP
handler best-effort po commitu (ztráta při selhání); přechody stavu nemají jednoho vlastníka (6 zápisů status literálů).

**Drivers:** D1 konzistentní alokace při souběhu (BR-02, REQ-04/09); D2 trvalé odložené schválení (BR-08, REQ-07/11);
D3 oddělené a spolehlivé doručení notifikace (BR-07, ADR-004); D4 jeden vlastník statechartu — [B](c03/architecture.md#b-architektonické-drivery).

**Decision question:** Kde a jak zajistit doručení potvrzovací notifikace, aby její selhání nezměnilo výsledek
Confirm/Approve a požadavek se neztratil?

**Alternatives:** A — synchronní best-effort volání v aplikační službě po commitu; B — transakční outbox + dispatcher
— [E1/E2](c03/architecture.md#e1-dvě-materiálně-odlišné-alternativy).

**Scenario walkthrough:** Confirm → PENDING_APPROVAL → konec requestu → pozdější Approve → dodavatel nedostupný /
pád procesu / souběžné Approve; A zprávu ztratí, B ji doručí později nebo označí FAILED — [E3](c03/architecture.md#e3-průchod-scénářem-confirm--approve-dodavatel-e-mailu-je-nedostupný).

**ADR:** [ADR-006 transakční outbox](architecture-and-decisions.md#adr-006--doručení-potvrzovací-notifikace-transakční-outbox);
doplňkové [ADR-007 jediný vlastník přechodů](architecture-and-decisions.md#adr-007--jediný-vlastník-přechodů-životního-cyklu-reservation).

**Views** (vše v [c03/architecture.md](c03/architecture.md), Mermaid):
- domain class — C1
- context — G1
- static architecture — G2
- state ownership — G3
- runtime/deployment — G4
- design sequence — H1 (Approve, alt kolize, asynchronní dispatch)
- focused design class — H2

**Cross-view issues found/resolved:** oprávnění mělo dva vlastníky (Identity `requirePatient` + inline) → celé BR-05 do
Lifecycle; blokující stav BR-02 duplikován v Availability → závislost na `BLOCKING_STATUS`; outbox potřebuje runtime
aktivitu mimo request → Dispatcher explicitně v G4 a `server.ts`; stavy doručení nepatří do statechartu Reservation → vlastník Outbox (G3) — [I](c03/architecture.md#i-cross-view-kontrola-provedena-před-změnou-kódu).

**AS-IS → TO-BE delta:** CHANGE — odeslání notifikace, evidence požadavků (outbox), rozhodování o přechodech, status
literály, oprávnění, interval/dostupnost; KEEP — DB exclusion constraint, zámek řádku a čas po zámku, demo identita;
VERIFY — HTTP kontrakt (C02 testy), směry závislostí (L2) — [J](c03/architecture.md#j-as-is--to-be-delta).

**Implementation changes:** commit `1e11105` — `notifications/outbox.ts`, migrace `20261006111636_notification_outbox`,
`reservations/lifecycle.ts`, `reservations/availability.ts`, `create.ts` → `reservation-service.ts`, `app.ts` bez notifikací,
dispatcher v `server.ts` — [K](c03/architecture.md#k-úprava-implementace).

**Behaviour verification:** 78/78 testů = 63 C02 testů (notifikace nyní ověřované přes dispatcher)
+ 5 outbox + 6 lifecycle + 4 architecture, typecheck, build — [c03-tests.txt](evidence/c03-tests.txt); živé demo
v0.2 se shodným výstupem jako C02 a jedním `SENT` požadavkem v outboxu — [c03-demo.txt](evidence/c03-demo.txt); tabulka [L1](c03/architecture.md#l1-ověření-chování).

**Architecture conformance rule + result:** (1) jen `notifications/**` a `server.ts` smí sahat na Notification Gateway;
(2) status `Reservation` jen v `reservations/lifecycle.ts`, bez I/O. Kontrola `apps/api/tests/architecture.test.ts`
(součást `npm test` a CI): TO-BE 4/4 zelené; proti AS-IS `b44c2e2` 3 ze 4 červené — [c03-architecture-asis.txt](evidence/c03-architecture-asis.txt).

**Remaining uncertainty / risk:**
- doručení je at-least-once; reálný dodavatel musí deduplikovat podle `reservationId`; odeslání delší než lease (60 s) může vést k duplicitě;
- parametry retry (8 pokusů, backoff 30 s·2^(n−1) max. 1 h, polling 2 s) jsou provizorní, bez zdroje v požadavcích;
- stav `FAILED` nikdo aktivně nesleduje (žádný alert ani admin pohled);
- dispatcher běží v jediném API procesu; škálování na více instancí je bezpečné (`SKIP LOCKED`), ale netestované v nasazení;
- `ReservationError` nese HTTP status i v doménovém Lifecycle; expirace zůstává on-access (bez časovače); identita je stále demo.

**Commit/tag:** implementace `1e11105`, evidence a tag `c03-architecture` na větvi `codex/c03-architecture`.

## C05 DD Verification Evidence

### Návrh před implementací

Selected architecture unit: **Reservation Lifecycle**, mutace existující rezervace podle ADR-007 a C02 v0.2. [C05 Detailed Design](architecture-and-decisions.md#c05-detailed-design) byl schválen zadavatelem a uložen jako commit `d8396a3` před odvozenými testy (`d1bf1bd`) a implementací (`3967202`). Tento sled dokládá návrhový záměr před kódem; není to zpětně nakreslená struktura.

### Tests derived from DD

Testovací tabulka a zdůvodnění dvou úrovní jsou součástí DD. [lifecycle.test.ts](../apps/api/tests/lifecycle.test.ts) obsahuje případy s ID C05-01 až C05-11: role/vlastnictví i při dodaném schedule, zákaz neplatného stavu, pořadí chyb, 24 kombinací stavu a operace, přesné časové hranice, dva průchody jednou policy, obě varianty potvrzení, cap deadline a nesdílená Date metadata. Celkem **48 unit případů vybrané jednotky**, nikoli počet nových testů navíc k původní sadě — C03 soubor se 6 testy byl nahrazen podrobnějšími případy odvozenými z DD.

DD-08 je ověřeno integračními [HTTP/PostgreSQL testy](../apps/api/tests/reservation-http.integration.test.ts): čas se bere po skutečném řádkovém zámku, expirace se ukládá i při 409 a kolize rollbackne stav i outbox požadavek. Tyto vlastnosti by mock DB neprokázal. Unit rozhodnutí samo neprokazuje výlučnost zdroje.

### Unit/component tests executed

Dne 13. 10. 2026, Node 24.19.0, npm 11.17.0, lokální PostgreSQL 17.9 na oddělené `bookerdoc_test`:

| Příkaz / fáze | Skutečný výsledek | Evidence |
| --- | --- | --- |
| První RED: `npm run test:integration -w @bookerdoc/api -- tests/lifecycle.test.ts` před implementací | 48 failed: nový export `reservationLifecycle` ještě neexistoval. To prokazuje chybějící nový kontrakt, nikoli 48 funkčních regresí starého HTTP API. | Tests commit `d1bf1bd`; implementace vznikla až později. |
| `npm run test:unit` po implementaci | **72 passed**: 48 Lifecycle, 20 Scheduling, 4 architecture checks; bez PostgreSQL a bez síťového připojení | [Unit výstup](evidence/c05-unit-tests.txt) |
| `npm test` | **120 passed**, 5 souborů, exit 0; včetně stávající HTTP/DB a outbox sady | [Celý výstup](evidence/c05-tests.txt) |
| `npm run typecheck` | API i web prošly | ověřeno před implementation commitem |
| `npm run build` | API i Vite web prošly | ověřeno před implementation commitem |

Nový kořenový příkaz `npm run test:unit` dovoluje ověřit DD bez spuštění databáze. Plné CI dál běží přes `npm test` a zahrnuje stejnou unit sadu i skutečnou persistence.

### Design ↔ implementation mismatch a resolution

| DD decision | Implemented? | Evidence | Action |
| --- | --- | --- | --- |
| DD-01 Jeden úplný kontrakt mutace s aktérem ve vstupu | YES | [LifecyclePolicy a TransitionCommand](../apps/api/src/reservations/lifecycle.ts), [Service](../apps/api/src/reservations/reservation-service.ts), C05-01 | keep |
| DD-02 Validní snapshot a povinný pending deadline | YES | `isExpired`, C05-03/11; datum je vstupní precondition, ne nová validace HTTP | keep, zachovat popsanou hranici |
| DD-03 Nové výsledky a kopie Date | YES | `expireIfDue` vrací nový objekt; pending metadata mají nové Date; C05-10 | keep |
| DD-04 Ani dodané schedule neobchází kontrolu přechodu | YES | privátní `evaluate` vždy autorizuje, kontroluje expiry, stav a čas; C05-01/02/08 | keep; staré veřejné `decide`/`allocate` odstraněny |
| DD-05 Jednoznačné pořadí chyb a approval větev | YES | evaluator; C05-03/06/09 | keep — *oprava po C06 F3: na baseline `1b3c1fb` bylo pořadí INVALID_STATE → START_MUST_BE_FUTURE → OUTSIDE_WORKING_WINDOW ověřeno jen částečně, doplněn test C05-12 ([C07](#c07--vypořádání-c06-findings))* |
| DD-06 Stavová tabulka | YES | parametrizovaných 24 kombinací C05-04 | keep |
| DD-07 Inkluzivní 24h, striktní deadline/start | YES | C05-05/06/07, PostgreSQL expiry za zámkem | keep |
| DD-08 Stejný snapshot/čas pro dva průchody; atomicita v Service | YES | Service vytvoří `command` jednou a podruhé přidá schedule; konečný Decision aplikuje v téže transakci; outbox integrační testy | keep |

Původní C03 spolupráce měla veřejné `allocate` s předpokladem, že klient nejprve správně zavolal `authorize` a `decide`. C05 záměr to změnil na úplný kontrakt, proto jsme upravili kód a klienta. Diagram jsme neupravovali zpětně tak, aby zachoval tuto mezeru. Ve výsledku není nevyřešený planned DD ↔ actual implementation rozdíl; class diagram označuje modulové role, implementace nepotřebuje nové runtime třídy.

Business pravidla HTTP v0.2 zůstávají zachovaná. Future-start guard je nyní také uvnitř Lifecycle, takže ani přímý klient s `fits=true` nemůže navrhnout minulou alokaci. API není nově oprávněno přijímat pracovní fakta od uživatele.

### Remaining design risk

Schedule je důvěryhodný snapshot z interní služby; Lifecycle nemůže sama potvrdit jeho aktuálnost. Service musí držet zámek a použít stejný čas mezi průchody. Budoucí souběžná editace pracovních oken může vyžadovat další konzistenční pravidlo. Readonly typy neověřují runtime validitu Date, která je explicitní precondition; požadavky HTTP a data z DB ji v současné cestě zajišťují. Kolizní ochrana a atomický outbox zůstávají v DB transakci. `ReservationError` stále nese HTTP status jako známý kompromis C03.

### Commit/tag

Návrh `d8396a3` → tests `d1bf1bd` → implementation `3967202` → tato evidence. Reprodukovatelný výsledný snapshot: tag **`c05-detailed-design`**. Tag označuje ověřený slice, nenahrazuje skutečné týmové review PR před merge.

## C07 — Vypořádání C06 findings

**Dvě verze, dvě role.**
- **C06 assessed baseline:** `1b3c1fb` (merge PR #10, obsahově = tag `c05-detailed-design`). Hodnotil tým Holy Trio 26. 10. 2026. Viz [assessment s owner disposition](c06/assessment-holy-trio.md).
- **Reporting baseline C08:** tag `c08-reporting-baseline` na větvi `codex/c07-c08-cp1-review`. Opravy jsou v commitech `77f235d` (testy F1, F3) a `2c0c5b4` (pohledy C03 a ADR-007, F2). K 3. 11. 2026 je větev **jen lokální, nepushnutá a bez týmového review**.

**Prostředí ověření:** Windows 11, Node 24.19.0 / npm 11.17.0, Docker Desktop 28.0.1, PostgreSQL 17.9 z `compose.yaml`. Na tomto stroji běží systémový Node 20.17.0 a `npm ci` s ním skončí `EBADENGINE`. Použili jsme proto přenosný Node 24.19.0 (viz R-01).

**Reprodukce baseline:** na `1b3c1fb` bez změn: `npm test` **120/120**, `npm run test:unit` **72/72**. Výsledek se shoduje s C06 (B2) i s C05 evidencí.

**Postup pro každý nález:** Claim → Expected → Observed → Verify (reprodukce na `1b3c1fb`) → Disposition → Closure. Mutace, příkazy a výstupy jsou v [c07-c06-findings-verification.txt](evidence/c07-c06-findings-verification.txt).

| C06 položka | Expected ↔ Observed | Evidence (baseline → nová verze) | Decision | Action + owner / closure |
| --- | --- | --- | --- | --- |
| **F1** — BR-01 + BR-02 při Confirm: navazující `[start,end)` intervaly nekolidují, autoritativně je vynucuje `reservation_no_overlap` | Expected: test prokáže, že Confirm vedle CONFIRMED uspěje. Observed: sousedství bylo ověřeno jen pro Availability (vlastní dotaz). Mutant constraintu `'[]'` přežil **120/120** | `1b3c1fb`: mutant přežil → `77f235d`: test „C06 F1 / BR-01+BR-02“ (08:30 a 09:30 → 200, 09:15 → 409) a přímý DB test sousedních CONFIRMED; mutant zabit (**2 failed / 124**) | **VERIFIED FINDING → ACCEPT.** Chyběla evidence, nikoli implementace | Štěpán Rychlý, hotovo 3. 11. **Closure VERIFIED** (mutant zabit, sada 124/124). Týmové review: NOT VERIFIED |
| **F2** — C03 H1/H2/G2/G3 a ADR-007: Service volá `authorize → decide → allocate` | Expected: pohledy odpovídají call path. Observed: tyto funkce v `src/` neexistují (0 výskytů), skutečně se 2× volá `reservationLifecycle.evaluate` | `1b3c1fb`: grep exportů a docs → `2c0c5b4`: G2, G3, H1, H2, text pod H2 a důsledky ADR-007 přepsány; původní znění v tagu `c03-architecture` | **VERIFIED FINDING → ACCEPT.** Rozhodnutí ADR-007 platí, zastaralý byl jeho popis | Štěpán Rychlý, hotovo 3. 11. **Closure:** `grep` docs ↔ `src` sedí; review pohledů týmem NOT VERIFIED |
| **F3** — C05 DD-05 pořadí chyb; evidence C05 tvrdila „pořadí chyb ověřeno“ | Expected: testy rozliší (a) INVALID_STATE před START_MUST_BE_FUTURE, (b) START_MUST_BE_FUTURE před OUTSIDE_WORKING_WINDOW. Observed: mutanti M1 a M2 přežili **72/72** | `1b3c1fb`: M1 i M2 přežili → `77f235d`: C05-12 (3 případy); M1 zabit 1 testem, M2 2 testy (75 unit) | **VERIFIED FINDING → ACCEPT.** Implementace odpovídá DD, evidence přeceňovala ověření | Štěpán Rychlý, hotovo 3. 11. **Closure VERIFIED** (oba mutanti zabiti). C05 evidence (řádek DD-05) a tabulka testů DD odkazují na opravu |

**Výsledek na reporting baseline:** `npm test` **124/124** ([c07-tests.txt](evidence/c07-tests.txt)), `npm run test:unit` **75/75** ([c07-unit-tests.txt](evidence/c07-unit-tests.txt)), `npm run typecheck` a `npm run build` exit 0. Žádný kandidát nebyl zamítnut. Body ze sekce „Scope check“ v assessmentu (autentizace, reálný e-mail, coverage…) nepřebíráme jako nové povinnosti C01–C05; jsou to rizika R-06 a R-07 níže.

**Otevřené issues (již nastalé problémy, nejde o rizika):**
- **I-01** Opravy F1–F3 nejsou na GitHubu, nemají review a nejsou v `master`. Push zatím vědomě odložen. → Owner: Štěpán Rychlý; PR, review jiným členem a merge do 6. 11. 2026.
- **I-02** Specifikace v0.2 stále uvádí týmové schválení jako **PENDING** ([v02.md](c02/v02.md), stav). → Owner: Jan Horák; zaznamenat schválení v review a upravit stav do 10. 11. 2026.
- **I-03** V repozitáři není žádný C04 artefakt (quality concern, criterion, measurement). C06 jej hodnotilo jako N/A, protože C04 nebylo týmovým odevzdáním. Pokud cvičící potvrdí opak, mění se na otevřenou mezeru. → Owner: Štěpán Rychlý; ověřit u cvičícího do 10. 11. 2026.
- **I-04 (vyřešeno)** Systémový Node 20.17.0 na stroji Š. Rychlého neprojde `engine-strict`. Vyřešeno přenosným Node 24.19.0 a doplněnou sekcí README.

## Registr rizik — C07/C08

Klasifikace podle zadání: L × I, kde 1–2 = LOW, 3–4 = MEDIUM, 6–9 = HIGH. Skutečné reziduální riziko uvádíme jen po ověřeném opatření, jinak **NOT VERIFIED**. Vlastníci a termíny jsou návrh z 3. 11. 2026 a tým je potvrdí na C08.

| ID | Kategorie | Počáteční | Strategie | Očekávané rezid. | Skutečné rezid. |
| --- | --- | --- | --- | --- | --- |
| R-01 | Release / Operation | L3 × I2 = HIGH (6) | MITIGATE | L1 × I2 = LOW (2) | L2 × I2 = MEDIUM (4), ověřeno částečně |
| R-02 | People / Resources | L2 × I3 = HIGH (6) | MITIGATE | L1 × I2 = LOW (2) | NOT VERIFIED |
| R-03 | Technical / Quality | L3 × I3 = HIGH (9) | MITIGATE | L1 × I3 = MEDIUM (3) | L1 × I3 = MEDIUM (3), VERIFIED |
| R-04 | Scope / Requirements | L2 × I2 = MEDIUM (4) | MITIGATE | L1 × I2 = LOW (2) | NOT VERIFIED |
| R-05 | Schedule / Integration | L2 × I2 = MEDIUM (4) | MITIGATE | L1 × I2 = LOW (2) | NOT VERIFIED |
| R-06 | Security / Privacy | L1 × I2 = LOW (2) | ACCEPT | L1 × I2 = LOW (2) | přijato, bez opatření |
| R-07 | External dependency | L1 × I2 = LOW (2) | ACCEPT | L1 × I2 = LOW (2) | přijato, bez opatření |

### R-01
- **Popis rizika:** Build a testy byly ověřovány hlavně v prostředí autora (macOS, Node 24, běžící Docker) a README neuvádí specifika jiných OS → na jiném stroji projekt nenaběhne (jiný Node, vypnutý Docker, nedostupné stažení Prisma enginu) → zdrží se integrace a hrozí nefunkční živé demo při obhajobě CP1/CP2.
- **Kategorie:** Release / Operation.
- **Počáteční riziko (L/I/priorita/důvod):** L=3, I=2 → HIGH (6). L=3, protože problém už nastal dvakrát: hodnotitelé C06 nestáhli migrační engine a migrace aplikovali ručně, a 3. 11. na Windows stroji Š. Rychlého odmítl `npm ci` systémový Node 20.17 (`EBADENGINE`) a Docker neběžel. I=2, protože obnova je realistická v řádu hodin, ale ohrožuje demo.
- **Strategie ošetření a zdůvodnění:** MITIGATE. Prostředí nelze zrušit (AVOID), PostgreSQL constraint je jádrem BR-02. Snížíme pravděpodobnost ověřeným postupem na dalších strojích.
- **Opatření, vlastník, termín:** (1) README: sekce pro Windows, kontrola Node 24 a Dockeru. Owner Štěpán Rychlý, hotovo 3. 11. (2) Čistý `git clone` a kroky README na stroji jiného člena než autor. Owner Štěpán Rychlý, hotovo 3. 11. (3) Totéž na stroji Daniela Krásného, který se použije jako záloha pro demo. Owner Daniel Krásný, do 9. 11. 2026.
- **Důkaz účinnosti a stav ověření:** (1) a (2) VERIFIED: čistý clone `2c0c5b4` na Windows, `npm ci` → `npm test` 124/124, typecheck i build prošly ([c07-clean-clone-windows.txt](evidence/c07-clean-clone-windows.txt)). (3) NOT VERIFIED.
- **Očekávané reziduální riziko:** L=1, I=2 → LOW (2), pokud projde i stroj (3).
- **Skutečné reziduální riziko / NOT VERIFIED:** L=2, I=2 → MEDIUM (4). Ověřen jeden další stroj a OS; stroj pro obhajobu zatím ověřen není.
- **Přijetí reziduálního rizika, vlastník, zdůvodnění:** Po splnění bodu (3) přijme LOW Jan Horák (repozitář vlastní). Contingency: demo z ověřeného stroje Š. Rychlého a předem uložené výstupy testů v `docs/evidence/`.
- **Monitoring, trigger, contingency, další review:** Trigger: změna `package.json`, `compose.yaml`, migrací nebo verze Node; selhání CI „Project checks“; čistý clone u kohokoli selže. Review na C08 (10. 11.) a týden před CP2.

### R-02
- **Popis rizika:** Většinu implementace psal jeden člen: 32 ze 41 commitů v historii je od Jana Horáka (C01, C02, C05), Š. Rychlý má 4 (C03), D. Krásný 2 merge. → Při jeho nedostupnosti před obhajobou ostatní neobhájí nebo nezmění Lifecycle, DB constraint a outbox. → Hodnocení „Engineering Review & Defence“ (společné pro tým) a dodávka CP2 se zhorší.
- **Kategorie:** People / Resources.
- **Počáteční riziko (L/I/priorita/důvod):** L=2, I=3 → HIGH (6). L=2: kumulace znalostí je doložená `git log`, ale nepřítomnost zatím nenastala. I=3: ohrožuje společnou obhajobu i dodávku.
- **Strategie ošetření a zdůvodnění:** MITIGATE. Zastupitelnost zvýšíme sdílením částí obhajoby a křížovým review.
- **Opatření, vlastník, termín:** Rozdělit části A tak, aby každý vedl jiný krok a živě spustil jeho evidenci (Jan: architektura a ADR; Štěpán: C06 findings a mutanti; Daniel: verifikace a čistý build). Zkouška celé obhajoby na týmové schůzce. Owner Jan Horák, do 9. 11. 2026. PR z C07 zrecenzuje člen, který ho nepsal.
- **Důkaz účinnosti a stav ověření:** NOT VERIFIED. Zatím existuje jen rozdělení v [technical-design-review.md](c08/technical-design-review.md); zkouška ani review neproběhly.
- **Očekávané reziduální riziko:** L=1, I=2 → LOW (2).
- **Skutečné reziduální riziko / NOT VERIFIED:** NOT VERIFIED.
- **Přijetí reziduálního rizika, vlastník, zdůvodnění:** Po zkoušce přijme tým (Jan Horák). Contingency: každý krok A má v dokumentu přesné příkazy a odkazy, takže ho může přednést kdokoli.
- **Monitoring, trigger, contingency, další review:** Trigger: člen nemůže být na C08/CP2; více než 80 % commitů nové práce od jednoho autora; PR bez review jiným členem. Review na C08.

### R-03
- **Popis rizika:** Testy nechránily kritické hranice: C06 ukázalo tři přeživší mutanty (F1 `'[]'` v BR-02, F3 M1 a M2 v DD-05). → Regrese invariantu BR-02 nebo změna HTTP kontraktu (400 místo 409) projde zeleným CI. → Porušení jádrového invariantu nebo neobhajitelná evidence při CP1/CP2.
- **Kategorie:** Technical / Quality.
- **Počáteční riziko (L/I/priorita/důvod):** L=3, I=3 → HIGH (9). L=3: tři mutanti na `1b3c1fb` skutečně přežili. I=3: BR-02 je hlavní business invariant.
- **Strategie ošetření a zdůvodnění:** MITIGATE. Doplníme cílené testy hranic a jejich účinnost doložíme mutací, ne pouhým počtem testů.
- **Opatření, vlastník, termín:** Testy F1 (HTTP i DB) a C05-12, commit `77f235d`. Owner Štěpán Rychlý, hotovo 3. 11. 2026. Při každé změně `lifecycle.ts` nebo migrací znovu spustit trojici mutantů.
- **Důkaz účinnosti a stav ověření:** VERIFIED: všichni tři mutanti jsou na nové verzi zabiti ([c07-c06-findings-verification.txt](evidence/c07-c06-findings-verification.txt)), sada 124/124 a 75/75.
- **Očekávané reziduální riziko:** L=1, I=3 → MEDIUM (3). Dopad zůstává vysoký, systematická mutační analýza ostatních hranic neproběhla.
- **Skutečné reziduální riziko / NOT VERIFIED:** L=1, I=3 → MEDIUM (3), VERIFIED pro známé mutanty.
- **Přijetí reziduálního rizika, vlastník, zdůvodnění:** MEDIUM přijímá Štěpán Rychlý: známé mezery jsou uzavřené, další hranice (BR-03 24h, BR-08 deadline) testy na přesné ms už mají.
- **Monitoring, trigger, contingency, další review:** Trigger: nový nález hodnotitele nebo cvičícího, změna constraintu či pořadí v `evaluate`, přeživší mutant. Review před CP2.

### R-04
- **Popis rizika:** Politika neblokujícího PENDING_APPROVAL a platnosti min(24 h, start) je schválená zadavatelem, ale týmové schválení je v dokumentaci stále PENDING (I-02). → Tým nebo cvičící ji při obhajobě či v CP2 zpochybní. → Přepracování Approval toku, testů a diagramů na poslední chvíli.
- **Kategorie:** Scope / Requirements.
- **Počáteční riziko (L/I/priorita/důvod):** L=2, I=2 → MEDIUM (4). L=2: stav PENDING je otevřený od 22. 9. I=2: změna by zasáhla REQ-07 až REQ-11, ale obnova je realistická.
- **Strategie ošetření a zdůvodnění:** MITIGATE. Rozhodnutí explicitně zaznamenáme.
- **Opatření, vlastník, termín:** Schválení v PR review a úprava stavu ve [v02.md](c02/v02.md). Owner Jan Horák, do 10. 11. 2026.
- **Důkaz účinnosti a stav ověření:** NOT VERIFIED.
- **Očekávané reziduální riziko:** L=1, I=2 → LOW (2).
- **Skutečné reziduální riziko / NOT VERIFIED:** NOT VERIFIED.
- **Přijetí reziduálního rizika, vlastník, zdůvodnění:** Jan Horák po záznamu schválení.
- **Monitoring, trigger, contingency, další review:** Trigger: připomínka cvičícího k Approval nebo nové zadání CP2 měnící schvalování. Review na C08.

### R-05
- **Popis rizika:** Práce vzniká na dlouho žijících lokálních větvích a integruje se pozdě: C03 větev byla mergnuta 12. 10., šest dní po dokončení; v C02 byla nutná samostatná integrační oprava (PR #7); 3. 11. byl lokální `master` u Š. Rychlého 10 commitů pozadu; C07 opravy jsou zatím jen lokálně (I-01). → Změny C07/C08 se střetnou s další prací. → Konflikty a regrese těsně před C08 nebo CP2.
- **Kategorie:** Schedule / Integration.
- **Počáteční riziko (L/I/priorita/důvod):** L=2, I=2 → MEDIUM (4). L=2: opakovaný vzor zpožděných merge. I=2: oprava je možná, ale stojí čas před termínem.
- **Strategie ošetření a zdůvodnění:** MITIGATE. Malé PR, merge do dvou dnů, CI jako brána.
- **Opatření, vlastník, termín:** Push `codex/c07-c08-cp1-review`, PR s review jiným členem, zelené CI, merge a push tagu. Owner Štěpán Rychlý, do 6. 11. 2026. Před prací vždy `git fetch`.
- **Důkaz účinnosti a stav ověření:** NOT VERIFIED (push vědomě odložen).
- **Očekávané reziduální riziko:** L=1, I=2 → LOW (2).
- **Skutečné reziduální riziko / NOT VERIFIED:** NOT VERIFIED.
- **Přijetí reziduálního rizika, vlastník, zdůvodnění:** Štěpán Rychlý po merge.
- **Monitoring, trigger, contingency, další review:** Trigger: PR otevřený déle než 2 dny, konflikt při merge, červené CI. Contingency: prezentovat z tagu `c08-reporting-baseline` a stav označit jako „not integrated“.

### R-06
- **Popis rizika:** Identita je jen veřejná mapa demo tokenů z `.env.example`. → Kdyby API běželo mimo localhost (např. demo ze sdíleného stroje), mohl by kdokoli s tokenem jednat za pacienta nebo lékaře. → Neoprávněná změna rezervace a únik e-mailu pacienta.
- **Kategorie:** Security / Privacy.
- **Počáteční riziko (L/I/priorita/důvod):** L=1, I=2 → LOW (2). L=1: API poslouchá jen na 127.0.0.1 a nasazení se neplánuje. I=2: data jsou syntetická.
- **Strategie ošetření a zdůvodnění:** ACCEPT. Produkční autentizace není povinností C01–C05 a C06 ji vědomě nehodnotilo.
- **Opatření, vlastník, termín:** Žádné. Omezení je uvedené v README.
- **Důkaz účinnosti a stav ověření:** N/A (přijato bez opatření).
- **Očekávané reziduální riziko:** L=1, I=2 → LOW (2).
- **Skutečné reziduální riziko / NOT VERIFIED:** LOW (2), přijato.
- **Přijetí reziduálního rizika, vlastník, zdůvodnění:** Jan Horák: demo běží lokálně se syntetickými daty.
- **Monitoring, trigger, contingency, další review:** Trigger: plán vystavit API mimo localhost nebo použít reálná osobní data. Pak ADR k identitě.

### R-07
- **Popis rizika:** Notifikace jde přes stub. Outbox doručuje at-least-once a stav `FAILED` nikdo nesleduje. → Při napojení reálného dodavatele potvrzení nedorazí nebo dorazí dvakrát a nikdo si toho nevšimne. → Pacient nemá potvrzení termínu.
- **Kategorie:** External dependency.
- **Počáteční riziko (L/I/priorita/důvod):** L=1, I=2 → LOW (2). L=1: reálný dodavatel se pro CP1 nepoužívá. I=2: stav rezervace zůstává správný (ADR-006).
- **Strategie ošetření a zdůvodnění:** ACCEPT. Vědomý kompromis ADR-006, mimo povinnosti C01–C05.
- **Opatření, vlastník, termín:** Žádné pro CP1.
- **Důkaz účinnosti a stav ověření:** N/A. Retry i FAILED ověřují integrační testy outboxu se stubem.
- **Očekávané reziduální riziko:** L=1, I=2 → LOW (2).
- **Skutečné reziduální riziko / NOT VERIFIED:** LOW (2), přijato.
- **Přijetí reziduálního rizika, vlastník, zdůvodnění:** Štěpán Rychlý (autor ADR-006).
- **Monitoring, trigger, contingency, další review:** Trigger: požadavek na reálný e-mail v CP2 nebo první řádek `FAILED` v dev DB. Pak monitoring a deduplikace podle `reservationId`.
