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
