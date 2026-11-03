# C08 — Technical Design Review (část A, CP1)

**Tým:** BookerDoc (Jan Horák, Štěpán Rychlý, Daniel Krásný).
**Reporting baseline:** tag `c08-reporting-baseline` (větev `codex/c07-c08-cp1-review`; opravy C06 v `77f235d` a `2c0c5b4`).
**C06 assessed baseline:** `1b3c1fb` = tag `c05-detailed-design`. Stejný tag a stejné nálezy uvádí i status report
([PPTX](C08_Project_Status_BookerDoc.pptx)).

Forma: 8–10 min nad otevřeným repozitářem a běžícími testy, bez nového slide decku. Jedna argumentační linie:

> **REQ-04 + BR-02** (pro jednoho lékaře nikdy dvě překrývající se CONFIRMED) → **Architektura**: o přechodu rozhoduje
> Reservation Lifecycle (ADR-007), výlučnost autoritativně drží PostgreSQL constraint v transakci Reservation Service
> (ADR-003) → **DD**: `LifecyclePolicy.evaluate` ve dvou průchodech pod row lockem → **Evidence**: sousední interval
> projde, překryv a souběh ne → **C06 F1**: tato hranice neměla důkaz, doplnili jsme ho a ověřili mutací.

Rozdělení řečníků (opatření k riziku R-02, každý spouští svou evidenci živě): kroky 1–2 Jan Horák, krok 3 Daniel
Krásný, kroky 4–5 Štěpán Rychlý. Rozdělení je návrh a potvrdí ho zkouška do 9. 11. 2026.

---

## 1. Scope & accepted behavior (≈1,5 min)

| Co ukázat | Kde |
| --- | --- |
| Doména: rezervace termínů u lékaře. Resource = lékař (výlučný), role pacient a lékař, hranice systému a externí Notification Service | [v02 § Případy užití](../c02/v02.md#případy-užití-a-hranice-systému), [C03 G1](../c03/architecture.md#g1-kontext-systému) |
| Vybraná operace **OP-03 Confirm**: vstup = ID vlastního DRAFT; precondition = vlastník, DRAFT, budoucí start v pracovním okně (BR-04); postcondition = CONFIRMED, nebo PENDING_APPROVAL s `requestedAt/expiresAt` | [v02 § OP-03](../c02/v02.md#op-03--confirm-reservation-nahrazuje-op-03-v01) |
| Invariant **BR-02**: blokuje jen CONFIRMED, intervaly `[start,end)` (BR-01), sousední intervaly nekolidují | [v02 § Centrální pravidla](../c02/v02.md#centrální-pravidla-v02) |
| **Změna C02 (Approval):** lékař s `requiresApproval` → Confirm vede do PENDING_APPROVAL, které neblokuje. BR-02 se uplatní až při Approve | [statechart v0.2](../c02/v02.md#životní-cyklus), [analýza dopadu](../c02/v02-impact.md) |
| Konkrétní příklad ověření: CONFIRMED 09:00–09:30 → Confirm 09:30–10:00 = 200; Confirm 09:15–09:45 = 409 a zůstane DRAFT | test „C06 F1 / BR-01+BR-02“ (krok 4) |

## 2. Architecture (≈2 min)

- **AS-IS → TO-BE:** v AS-IS rozhodoval o stavu inline handler, status literály byly na 6 místech a notifikace se
  posílala best-effort po commitu ([AS-IS A5](../architecture-and-decisions.md#a5-stav-změna-stavu-a-pravidlo)). TO-BE je v
  [C03 G2](../c03/architecture.md#g2-to-be-statická-architektura) a delta v [J](../c03/architecture.md#j-as-is--to-be-delta).
- **Drivery:** D1 konzistentní alokace při souběhu (BR-02, REQ-04/09) a D4 jeden vlastník statechartu.
- **Odpovědnosti a vlastníci:** Reservation Lifecycle rozhoduje přechod (R1). Reservation Service drží transakci, row lock
  a čas po zámku (BR-06). Persistence drží `reservation_no_overlap` (autoritativní BR-02). Vlastníky přechodů ukazuje
  tabulka [G3](../c03/architecture.md#g3-vlastnictví-přechodů-ve-statechartu).
- **Statický + dynamický pohled:** [G2](../c03/architecture.md#g2-to-be-statická-architektura) a
  [H1 Approve s větví kolize](../c03/architecture.md#h1-návrhový-sekvenční-diagram--approve-s-větví-kolize).
  Po C06 F2 oba odpovídají skutečnému call path.
- **Zvolená alternativa a ADR:** [ADR-007](../architecture-and-decisions.md#adr-007--jediný-vlastník-přechodů-životního-cyklu-reservation)
  B (čistý doménový modul místo transakčního skriptu) a [ADR-003](../architecture-and-decisions.md#adr-003--čas-a-souběh-návrh-pro-cp1)
  (DB exclusion constraint místo SELECT + INSERT). Doplňkově [ADR-006 outbox](../architecture-and-decisions.md#adr-006--doručení-potvrzovací-notifikace-transakční-outbox).
- **Implementace odpovídá rozhodnutí (živě):** `apps/api/tests/architecture.test.ts` strojově hlídá, že status literály
  jsou jen v `lifecycle.ts` a ten nemá I/O. Proti AS-IS `b44c2e2` selhaly 3 ze 4 kontrol
  ([c03-architecture-asis.txt](../evidence/c03-architecture-asis.txt)).

## 3. Detailed Design — jednotka Reservation Lifecycle (≈2 min)

- **Kontrakt:** `LifecyclePolicy.evaluate(TransitionCommand) → Decision` (`unchanged | expire | change | needsSchedule`),
  pre/postconditions DD-02/03 — [C05 DD](../architecture-and-decisions.md#key-interface--contract).
- **Klíčový algoritmus DD-05 (pořadí):** oprávnění → expiry → zdrojový stav (INVALID_STATE) → budoucí start
  (START_MUST_BE_FUTURE) → chybějící schedule (needsSchedule) → `fits` (OUTSIDE_WORKING_WINDOW) → PENDING_APPROVAL nebo
  CONFIRMED. Kód: [`lifecycle.ts:59-82`](../../apps/api/src/reservations/lifecycle.ts#L59-L82).
- **Hranice:** Lifecycle nečte DB a negarantuje kapacitu. BR-02 drží PostgreSQL a atomicitu Service
  ([`reservation-service.ts:39-76`](../../apps/api/src/reservations/reservation-service.ts#L39-L76): zámek `:42`,
  čas po zámku `:43`, dva průchody `:45` a `:49`, outbox v téže transakci `:65`, P2039 → 409 `:73`).
- **Větve a failure:** stavová tabulka DD-06 (24 kombinací) = test C05-04 ([`lifecycle.test.ts:51`](../../apps/api/tests/lifecycle.test.ts#L51)).
  Pořadí chyb chrání C05-12 ([`:109`](../../apps/api/tests/lifecycle.test.ts#L109), [`:116`](../../apps/api/tests/lifecycle.test.ts#L116)).
  Expiry se commitne i při 409 (DD-08, HTTP test REQ-11).

**Živě:** `npm run test:unit` → 75/75 bez databáze (48 + 3 Lifecycle, 20 Scheduling, 4 architecture).

## 4. Verification & Evidence (≈2 min)

| Případ | Oracle (expected ze specifikace) | Observed | Test |
| --- | --- | --- | --- |
| **Pozitivní hraniční:** Confirm intervalů 08:30–09:00 a 09:30–10:00 vedle CONFIRMED 09:00–09:30 | BR-01 `[start,end)`: sousední interval nekoliduje → 200 CONFIRMED, 3 notifikace | 200, 200, 3 CONFIRMED | [`reservation-http.integration.test.ts:94`](../../apps/api/tests/reservation-http.integration.test.ts#L94) |
| **Negativní:** Confirm 09:15–09:45 (překryv 15 min) | BR-02 → 409 RESERVATION_CONFLICT, rezervace zůstane DRAFT, žádný outbox | 409, DRAFT | týž test + REQ-03 (`:88`) |
| **Souběh:** dva Confirm konfliktních DRAFT současně | REQ-04: právě jeden 200, druhý 409, v DB 1 CONFIRMED | `[200, 409]` | REQ-04 (`:106`), REQ-09 Approve (`:216`) |

- **Podmínky měření:** skutečný PostgreSQL 17.9 (oddělená `bookerdoc_test`), serverový čas injektovaný testem
  (`instant`), HTTP přes supertest proti `createApp`. Mock DB by exclusion constraint ani row lock neprokázal.
- **Baseline verifikace:** `npm test` **124/124**, `npm run test:unit` **75/75**, typecheck a build OK
  ([c07-tests.txt](../evidence/c07-tests.txt)). Čistý clone na druhém stroji (Windows) také 124/124
  ([c07-clean-clone-windows.txt](../evidence/c07-clean-clone-windows.txt)).
- **C04 quality criterion:** v repozitáři žádný C04 artefakt není a C06 ho hodnotilo jako N/A (issue I-03).
  Nejbližší kvalitativní vlastnost, kterou skutečně měříme, je konzistence při souběhu (REQ-04/09). Tvrdíme jen to,
  co ukazuje test: 2 souběžné požadavky v jednom procesu, ne zátěž ani více instancí API.

**Živě:** `npm test` (≈ 10 s), pak otevřít výstup F1 testu.

## 5. C06 Findings & Engineering Decision (≈1,5 min)

Nejdůležitější nález je **F1**, protože se týká hlavního invariantu BR-02.

1. **Claim:** BR-01/BR-02 platí pro Confirm/Approve, autoritativně přes `reservation_no_overlap`.
2. **Ověření na `1b3c1fb`:** constraint jsme v testovací DB změnili na `'[]'`, takže sousední intervaly kolidují.
   Všech **120/120** testů přesto prošlo. Implementace byla správná, chyběl jen důkaz.
3. **Rozhodnutí:** VERIFIED FINDING → ACCEPT. Owner Štěpán Rychlý.
4. **Uzavření:** commit `77f235d` přidal HTTP test sousedství a přímý DB test. Stejný mutant je nyní zabit 2 testy
   (**2 failed / 124**). Po obnovení `'[)'` je sada 124/124
   ([c07-c06-findings-verification.txt](../evidence/c07-c06-findings-verification.txt)).
5. **Ostatní:** F3 (pořadí chyb DD-05, oba mutanti nyní zabiti testem C05-12) a F2 (zastaralé C03 pohledy, opraveno v
   `2c0c5b4`). Kompletní disposition: [assessment](../c06/assessment-holy-trio.md#owner-disposition).
6. **Otevřené:** opravy zatím nemají týmové review a nejsou v `master` (I-01, akce P1). Ve statusu proto nejsou „hotové
   a integrované“.

---

## Omezení, která přiznáváme

- Souběh je ověřen 2 paralelními požadavky v jednom API procesu. Dispatcher s více instancemi (`SKIP LOCKED`) je
  otestován jen ve stejném procesu.
- Notifikace jde přes stub (at-least-once, `FAILED` bez monitoringu, viz R-07). Identita jsou demo tokeny (R-06).
- `ReservationError` nese HTTP status i v doménovém modulu (vědomý kompromis C03).
- Týmové schválení specifikace v0.2 je v dokumentech stále PENDING (I-02, R-04).

## Pravděpodobné otázky a odpovědi

| Otázka | Odpověď a důkaz |
| --- | --- |
| Proč kolizi nekontroluje Lifecycle? | Čistá jednotka nevidí souběžné transakce. SELECT + INSERT bez DB ochrany nestačí (ADR-003). Lifecycle rozhoduje, *zda* smí přechod nastat; výlučnost drží DB v téže transakci. |
| Co když schedule z prvního průchodu zastará? | Oba průchody probíhají pod row lockem se stejným `time` (DD-08). Souběžná editace pracovních oken není v API, je to přiznané riziko C05. |
| Proč PENDING_APPROVAL neblokuje? | Rozhodnutí v0.2 (BR-02). Kapacita se přiděluje až při Approve a konflikt Approve vrací 409 a nechá žádost čekat (REQ-09). |
| Jak víte, že nové testy něco testují? | Mutace: stejné změny, které na `1b3c1fb` prošly, nyní testy shodí (F1: 2 testy, F3: 1 + 2 testy). |
| Je F2 jen kosmetika? | Ne. Pohledy C03 popisovaly nehlídaný veřejný `allocate`, který C05 záměrně odstranil (DD-04). Zastaralý diagram by sváděl k obejití guardů. |
