# C06 — Assessment Form (CZ)

## Projekt

```text
Hodnotící tým:        Holy Trio — Rostislav Nevoral, Pavel Mynář, Pavel Valošek
Hodnocený tým:        BookerDoc — Jan Horák (ethanjojo), Štěpán Rychlý, Daniel Krásný
Projekt:              BookerDoc — rezervace termínů u lékařů (https://github.com/ethanjojo/reservationsystem-swi)
Assessed commit/tag:  master 1b3c1fb438951ded6045e2584b45733029cad7dd (merge PR #10);
                      obsahově shodný s tagem c05-detailed-design (f67f893) — `git diff c05-detailed-design master` je prázdný
Datum:                26. 10. 2026
```

**Prostředí:** Node 24.19.0, npm 11.17.0, PostgreSQL 16 (lokální instance místo `postgres:17.9` z `compose.yaml`).
Migrační engine Prismy se v našem prostředí nepodařilo stáhnout (síť), proto bylo 5 SQL migrací z `apps/api/prisma/migrations/` aplikováno ručně přes `psql` ve stejném pořadí jako `prisma migrate deploy`. Jde o omezení hodnotícího prostředí, nikoli o vadu projektu.

**Výběr:**
- C02 operace: **OP-03 Confirm Reservation** (`docs/c02/v02.md` §OP-03)
- C02 pravidlo: **BR-02 Exkluzivita** (+ hranice z BR-01 „navazující intervaly nekolidují“)
- C03 responsibility: **R1 — rozhodnutí o přechodu stavu** (owner: Reservation Lifecycle, ADR-007)
- C03 interaction: **H1 — Approve s větví kolize** (`docs/c03/architecture.md` §H1)
- C03 ADR: **ADR-007 — Jediný vlastník přechodů životního cyklu**
- C04 concern: **N/A** (viz sekce C04)
- C05 unit: **Reservation Lifecycle** (`LifecyclePolicy.evaluate`), DD v `docs/architecture-and-decisions.md` §C05 Detailed Design

## Stavy

`YES / PARTLY / NO / N/A`

Každý řádek musí obsahovat Evidence.

## Baseline

| ID | Odpověď | Evidence / komentář |
|---|---|---|
| B1 Stejná identifikovaná baseline pro docs/code/tests | **YES** | `git rev-parse HEAD` = `1b3c1fb…`; `git diff --stat c05-detailed-design master` → žádný rozdíl, takže docs (`docs/`), kód (`apps/api/src/`) i testy (`apps/api/tests/`) jsou z jednoho snapshotu. Tagy `c02-v0.1`, `c02-v0.2`, `c03-architecture`, `c05-detailed-design` existují. C05 evidence (`docs/evidence-and-evolution.md` §C05) uvádí sled `d8396a3` (DD) → `d1bf1bd` (testy) → `3967202` (impl), což odpovídá `git log`. Poznámka mimo hodnocení: `README.md` je zastaralý (nadpis „C02 baseline v0.2“, „toto v0.2 PR“, chybí odkaz na `docs/c03/architecture.md`). Cesty k C03 artefaktům proto bylo nutné dohledat ručně. |
| B2 Relevantní produkt nebo testy lze spustit | **YES** | `npm ci` → OK; `npm run db:generate` → OK; vitest suite (`npm run test:integration -w @bookerdoc/api` nad `bookerdoc_test`): **Test Files 5 passed, Tests 120 passed (120)**; `npm run test:unit`: **72 passed** (bez DB); `npm run typecheck`: exit 0. Výsledek odpovídá deklaraci v `docs/evidence-and-evolution.md` §C05 („120 passed“, „72 passed“). Odchylka prostředí (PG 16, ruční migrace) je popsána výše. |

## C02 — Engineering Specification

Vybraná operace: **OP-03 Confirm Reservation**  
Vybraný business rule / invariant: **BR-02 Exkluzivita** (s hranicí BR-01 `[start,end)`)

| ID | Odpověď | Evidence / komentář |
|---|---|---|
| R1 Operation: input + precondition + postcondition/state | **YES** | `docs/c02/v02.md` §OP-03 (ř. 28–41). **Vstup:** ID vlastní DRAFT, prázdné tělo (`README.md` HTTP kontrakt). **Precondition:** identifikovaný vlastník, existující DRAFT, BR-04 (budoucí start, interval v pracovním okně). **Postcondition:** stejná identita i časy; CONFIRMED, nebo PENDING_APPROVAL s `requestedAt/expiresAt`. **Změna stavu:** DRAFT → CONFIRMED / PENDING_APPROVAL. Alternativy (401/403/404/409/400) jsou vyjmenované. |
| R2 Business rule/invariant je jednoznačný | **YES** | `docs/c02/v02.md` ř. 13–14. Vlastními slovy: *pro jednoho lékaře nesmí v žádném okamžiku existovat dvě commitnuté rezervace ve stavu CONFIRMED, jejichž polootevřené intervaly `[start,end)` se protínají, a to bez ohledu na službu. Jiné stavy kapacitu neblokují. Navazující intervaly (konec = začátek) kolizí nejsou.* Hranice i blokující stav jsou explicitní, k pravidlu není třeba nic domýšlet. |
| R3 Operation/rule je konzistentní se state modelem | **YES** | Statechart `docs/c02/v02.md` §Životní cyklus (ř. 143–158). Do CONFIRMED se dá vstoupit jen přes `Confirm [bez schvalování, BR-02/04]` a `Approve [BR-02/04]`. PENDING_APPROVAL je samostatný neblokující stav, což odpovídá BR-02 i OP-03 („platný draft může přejít do čekání i přes obsazený termín“). Neúspěch kolize zachovává DRAFT a v diagramu nevzniká žádný přechod. Rozpor jsme nenašli. |
| R4 Implementace odpovídá specifikované semantics | **YES** | Code path: `app.ts` (`POST /reservations/:id/confirm`) → `reservation-service.ts:39 changeReservation` → `:42 lockedReservation` (`SELECT … FOR UPDATE`) → `:43 time = now()` po zámku (BR-06) → `:45 reservationLifecycle.evaluate` → `lifecycle.ts:60 authorize`, `:71–72 DRAFT jinak INVALID_STATE`, `:74 START_MUST_BE_FUTURE`, `:75 needsSchedule` → `reservation-service.ts:48 scheduleInterval` → `:49` druhý `evaluate` → `lifecycle.ts:81 CONFIRMED` / `:77–79 PENDING_APPROVAL` → `update` + `:65 enqueueConfirmation` v téže tx. BR-02 autoritativně vynucuje `migrations/20260915132500_reservation_constraints/migration.sql`: `EXCLUDE USING gist ("doctorId" WITH =, tstzrange(startsAt, endsAt, '[)') WITH &&) WHERE status='CONFIRMED'`, a `:73 P2039` se mapuje na 409 RESERVATION_CONFLICT. Rollback zachová DRAFT. Navíc jsme přímým SQL ověřili, že dvě navazující CONFIRMED (10:00–11:00 a 11:00–12:00) constraint přijme. |
| R5 Existuje vhodná verification evidence | **PARTLY** | Existuje: `reservation-http.integration.test.ts:88` REQ-03 (kolize → 409, DRAFT zachován), `:94` REQ-04 (souběžné Confirm → [200,409], právě 1 CONFIRMED), `:204` REQ-09 (souběžné Approve), `reservation.integration.test.ts` přímý test EXCLUDE pro částečný překryv. **Chybí:** test, že Confirm **navazující** rezervace uspěje (hranice BR-01/BR-02 na autoritativní vrstvě). Test sousedství `:78` REQ-02 ověřuje jen Availability, a ta má vlastní dotaz (`availability.ts`), nikoli DB constraint. Mutace constraintu na `'[]'` přežila **všech 120 testů** → viz **F1**. |

## C03 — Architecture

Vybraná responsibility: **R1 — rozhodnout, zda je přechod stavu povolený a do jakého stavu** (`docs/c03/architecture.md` §C2)  
Vybraná interaction: **H1 — Approve s větví kolize** (§H1)  
Vybrané ADR/decision: **ADR-007 — Jediný vlastník přechodů** (`docs/architecture-and-decisions.md` ř. 234–256)

| ID | Odpověď | Evidence / komentář |
|---|---|---|
| A1 Responsibility + owner jsou explicitní | **YES** | §C2 tabulka R1 „jeden jasný vlastník: ano“; §G2 prvek **Reservation Lifecycle** „owns: statechart v0.2, BR-03/05/08, blokující stav BR-02“; §G3 přiřazuje vlastníka každému přechodu; mapování na kód `src/reservations/lifecycle.ts` (§G2 „Mapování na kód“). |
| A2 Skutečný code ownership odpovídá architektuře | **YES** | Všechna rozhodnutí o cílovém stavu jsou v `lifecycle.ts` (`evaluate`, `expireIfDue`, `INITIAL_STATE`, `BLOCKING_STATUS`). `reservation-service.ts` jen aplikuje `decision.change`. `grep` status literálů v `src/` mimo `lifecycle.ts` nenašel žádný literál Reservation statusu (outbox `PENDING/SENT/FAILED` je jiný stavový automat, jak správně uvádí §G3). Strojově to kontroluje `tests/architecture.test.ts` „ADR-007: only reservations/lifecycle.ts decides Reservation status“, test prošel a obsahuje i negativní kontrolu. |
| A3 Dynamic interaction odpovídá skutečnému call path | **PARTLY** | **Struktura sedí:** lock → Lifecycle → Scheduling → Lifecycle → UPDATE → `enqueueConfirmation` v tx → COMMIT, případně P2039 → ROLLBACK → 409 (`reservation-service.ts:39–75`). **Zprávy nesedí:** H1 (ř. 258–266) uvádí `SVC->>LC: authorize`, `decide(row,"approve",now)` a `allocate(row,"approve",now,schedule)`. Tyto funkce v kódu **neexistují**, protože je C05 commit `3967202` odstranil. Skutečně se 2× volá `reservationLifecycle.evaluate(command)` (`:45`, `:49`). Stejně zastaralé jsou H2 (ř. 314–315 `+decide`, `+allocate`), G2 (ř. 191 „authorize / decide / allocate“), G3 (ř. 218–223) a text pod H2 (ř. 370). Viz **F2**. |
| A4 ADR/decision odpovídá současné implementaci | **YES** | Jádro rozhodnutí ADR-007 („čistý doménový modul bez I/O vrací `Decision`/`StateChange`, služba jen zamyká a aplikuje“) je v kódu viditelné: `lifecycle.ts` nemá runtime import mimo `reservations/`, což ověřuje `architecture.test.ts`. Výhrada: odstavec „Přijaté negativní důsledky“ (ř. 251) stále popisuje dvoukrokové `decide → needsSchedule → allocate`. Rozhodnutí tedy platí, ale jeho popis důsledků nebyl po C05 aktualizován. Je to součást **F2**. |

## C04 — Quality & Measurement

Quality concern: **N/A**  
Criterion: **N/A**

| ID | Odpověď | Evidence / komentář |
|---|---|---|
| Q1 Criterion je skutečně evaluable | **N/A** | V repozitáři neexistuje žádný C04 artefakt: `grep -rn "C04"` najde jen zmínku v C01 DoD („runnable … před C04“), žádný tag `c04-*`, žádný dokument s quality concern/criterion/measurement. Podle informace k zadání C04 nebylo týmovým odevzdáním projektu, takže podle pravidla C06 („nepřidávat zpětně požadavky“) nehodnotíme. *Pokud C04 týmové odevzdání bylo, změnit Q1–Q3 na **NO** s evidencí „C04 artefakt v baseline 1b3c1fb chybí“.* |
| Q2 Measurement měří criterion ve správném contextu | **N/A** | Viz Q1: neexistuje measurement k posouzení. |
| Q3 Decision odpovídá výsledku měření | **N/A** | Viz Q1: neexistuje quality decision k posouzení. |

## C05 — Detailed Design & Unit Verification

Vybraná software unit: **Reservation Lifecycle** — `LifecyclePolicy.evaluate(command)` (`src/reservations/lifecycle.ts`), DD `docs/architecture-and-decisions.md` ř. 258–452

| ID | Odpověď | Evidence / komentář |
|---|---|---|
| D1 Design intent je explicitní a pochopitelný | **YES** | DD obsahuje responsibilities s důvody (ř. 268–278), ownership (ř. 280–288), kontrakt `TransitionCommand → Decision` s pre/postconditions a failures (DD-02/03, ř. 290–310), strukturní pohled, pseudokód pořadí rozhodnutí **DD-05** (ř. 372–390), úplnou stavovou tabulku **DD-06** (24 kombinací), časové hranice **DD-07** (ř. 404) a sekvenci dvou průchodů **DD-08**. Z DD lze jednotku implementovat bez domýšlení. |
| D2 DD odpovídá skutečné implementaci | **YES** | `lifecycle.ts:59–82` řádek po řádku odpovídá DD-05: `authorize` (:60) → expiry (:61) → cancel větev (:63–69) → required state (:71–72) → reject (:73) → future start (:74) → needsSchedule (:75) → fits (:76) → PENDING_APPROVAL s `min(now+24h,start)` a novými `Date` (:77–79, DD-03) → CONFIRMED (:81). `evaluate` je privátní a exportuje se jen `reservationLifecycle: LifecyclePolicy` (:84), takže DD-04 „žádný veřejný `allocate`“ platí. Service volá druhý průchod se stejným `command` + `schedule` (`reservation-service.ts:44–50`, DD-08). |
| D3 Unit/component tests jsou odvoditelné z DD | **YES** | `tests/lifecycle.test.ts` nese ID C05-01…C05-11 a DD §Tests derived from DD (ř. 430–442) mapuje každé DD-xx na C05-xx. C05-04 (ř. 41–56) je doslovný přepis tabulky DD-06. Celkem 48 unit případů, ověřeno během: 72 unit = 48 + 20 Scheduling + 4 architecture. |
| D4 Relevantní branches/boundaries/states/failures jsou ověřeny | **PARTLY** | Ověřeno: 24 stavových kombinací (C05-04), FORBIDDEN před expiry (C05-03), expiry před stavem (C05-06), 24h přesně / −1 ms (C05-05), deadline −1 ms / přesně (C05-06), start = now / now−1 ms (C05-07), `fits=false` (C05-08), cap deadline (C05-09), neměnnost (C05-10), chybějící deadline (C05-11). **Neověřeno:** dvě explicitní rozhodnutí pořadí z DD-05: (a) INVALID_STATE má přednost před START_MUST_BE_FUTURE, (b) START_MUST_BE_FUTURE má přednost před OUTSIDE_WORKING_WINDOW. Prohození pořadí v `lifecycle.ts` přežilo všech 72 unit i 120 celkových testů, přestože evidence tvrdí „pořadí chyb“ ověřeno (`evidence-and-evolution.md` ř. 244, 270). Viz **F3**. |
| D5 Vybraný test má smysluplný oracle/expected result | **YES** | Test `C05-04: $status + $operation => $expected` (`lifecycle.test.ts:51`): expected hodnoty jsou ručně zapsaná tabulka (ř. 41–48), která je 1:1 tabulkou DD-06, a nepočítají se voláním implementace. Komentář ř. 4: „expected outcomes come from the DD table, not from implementation branches“. Podobně C05-09 očekává `approvalExpiresAt = min(time+24h, start)` z BR-08. Oracle tedy vychází ze specifikace a DD. |

## Candidate findings

### F1

```text
Source:
C02 (OP-03 Confirm, BR-01/BR-02) — verification evidence (R5)

Engineering claim:
„Navazující intervaly nekolidují“ (BR-01) a BR-02 platí pro alokaci přes Confirm/Approve;
autoritativní vynucení je DB constraint reservation_no_overlap (ADR-003, C03 §G2 „Persistence owns … autoritativní BR-02“).

Expected:
docs/c02/v02.md ř. 13–14 (BR-01, BR-02) a docs/c02/v01.md OP-02 Ověření „[11,12) true“:
existuje ověření, že Confirm rezervace [11:00,12:00) vedle CONFIRMED [10:00,11:00) uspěje (200 CONFIRMED),
tj. že autoritativní vrstva rozlišuje sousedství od překryvu.

Observed:
Hranice sousedství je testována jen pro Availability (reservation-http.integration.test.ts:78, REQ-02),
která má vlastní dotaz (availability.ts, startsAt < end AND endsAt > start), nikoli DB constraint.
Testy Confirm/Approve (REQ-03 :88, REQ-04 :94, REQ-09 :204) používají shodný interval;
přímý constraint test (reservation.integration.test.ts) jen částečný překryv 09:00–09:30 vs 09:15–09:45.
Žádný test nepotvrzuje navazující CONFIRMED.

Evidence:
apps/api/prisma/migrations/20260915132500_reservation_constraints/migration.sql (tstzrange …, '[)');
apps/api/tests/reservation-http.integration.test.ts:78, :88, :94, :204;
apps/api/tests/reservation.integration.test.ts („enforces reservation CHECK and EXCLUDE constraints“).

Verification performed:
1) Dočasná mutace: constraint v testovací DB změněn na tstzrange(startsAt, endsAt, '[]')
   (sousední intervaly by kolidovaly) → celá sada: Tests 120 passed (120). Mutant přežil.
2) Ověření skutečného chování: přímým SQL vloženy dvě CONFIRMED 10:00–11:00 a 11:00–12:00
   stejného lékaře s originálním constraintem → obě přijaty (count = 2), ROLLBACK.
   Implementace je tedy správná, chybí pouze evidence.

Result: VERIFIED FINDING
(chybějící verification evidence pro hraniční případ BR-01/BR-02; nejde o chybu implementace)
```

### F2

```text
Source:
C03 (H1 dynamic view, H2, G2, G3, ADR-007) — architecture ↔ code (A3, A4)

Engineering claim:
docs/c03/architecture.md H1: Reservation Service volá Lifecycle přes authorize → decide → allocate;
„Každá zpráva z H1 má vlastníka v H2“ (ř. 370); ADR-007 důsledky: „decide → needsSchedule → allocate“.

Expected:
Dynamický pohled H1 a třídní pohled H2 popisují současný call path (C03 požadoval
„implementation a architecture conformance“). Pokud se API změnilo, pohled nebo ADR
se aktualizuje, nebo je výslovně označen jako nahrazený.

Observed:
V lifecycle.ts neexistují funkce authorize (veřejná), decide ani allocate; odstranil je C05 commit 3967202.
Skutečný průchod: reservation-service.ts:45 a :49 → reservationLifecycle.evaluate(command) dvakrát.
Zastaralé názvy zůstávají v c03/architecture.md ř. 191 (G2), 218–223 (G3), 258–266 (H1),
314–315 (H2), 370; architecture-and-decisions.md ř. 251 (ADR-007). V C03 dokumentu ani v ADR-007
není poznámka „nahrazeno C05“. Pouze C05 sekce (ř. 260) a evidence (ř. 275) uvádějí,
že C03 názvy „zůstávají historickým podkladem“ a „diagram jsme neupravovali“.

Evidence:
grep -n "^export" apps/api/src/reservations/lifecycle.ts (exporty: authorizeCreate, canRead, expireIfDue,
reservationLifecycle, isAllocation, INITIAL_STATE, BLOCKING_STATUS — bez decide/allocate);
grep -rnw "decide|allocate" apps/api/src → 0 výskytů; docs viz řádky výše.

Verification performed:
Porovnání sekvence H1 a třídního diagramu H2 se skutečným call path changeReservation;
grep exportů a výskytů v src/ a docs/.

Result: VERIFIED FINDING
(architektonické pohledy C03 a důsledky ADR-007 neodpovídají současné implementaci;
pozorovatelné chování a samotné rozhodnutí ADR-007 platí)
```

### F3

```text
Source:
C05 (DD-05 pořadí rozhodnutí) — DD ↔ tests (D4)

Engineering claim:
docs/architecture-and-decisions.md ř. 372–390 (DD-05) definuje pořadí:
… zdrojový stav → INVALID_STATE; … start <= now → START_MUST_BE_FUTURE;
bez schedule → needsSchedule; fits=false → OUTSIDE_WORKING_WINDOW.
docs/evidence-and-evolution.md ř. 244 a 270 tvrdí, že „pořadí chyb“ je ověřeno (C05-03/06/09).

Expected:
Testy odvozené z DD rozliší porušení definovaného pořadí, minimálně:
(a) CONFIRMED + confirm s minulým startem → 409 INVALID_STATE (ne 400);
(b) DRAFT + confirm, minulý start, schedule.fits=false → 400 START_MUST_BE_FUTURE.

Observed:
C05-03 ověřuje pouze FORBIDDEN před expiry; C05-06 expiry před stavem; C05-09 approval větev.
Kombinace (a) a (b) netestuje žádný test. C05-07 používá fits=true, C05-08 budoucí start.

Evidence:
apps/api/tests/lifecycle.test.ts:36 (C05-03), :72 (C05-07), :75 (C05-08);
apps/api/src/reservations/lifecycle.ts:71–76.

Verification performed:
1) Mutant 1: kontrola START_MUST_BE_FUTURE přesunuta před kontrolu stavu
   → npm run test:unit 72/72 passed, celá sada 120/120 passed (mutant přežil;
   mění i HTTP odpověď: confirm již potvrzené minulé rezervace by vrátil 400 místo 409).
2) Mutant 2: OUTSIDE_WORKING_WINDOW před START_MUST_BE_FUTURE → 72/72 i 120/120 passed.
3) Dočasný test (a) + (b) nad originálním kódem → 2 passed: implementace odpovídá DD,
   chybí jen test. Všechny dočasné změny vráceny (git status čistý).

Result: VERIFIED FINDING
(DD rozhodnutí o pořadí chyb jen částečně ověřeno; evidence tvrdí víc, než testy prokazují)
```

## Owner disposition

*Vyplnil hodnocený tým (BookerDoc) 3. 11. 2026, C07. Nálezy jsme reprodukovali na assessed baseline `1b3c1fb`
a opravy ověřili na větvi `codex/c07-c08-cp1-review` (tag `c08-reporting-baseline`,
[PR #12](https://github.com/ethanjojo/reservationsystem-swi/pull/12)). Postup a výstupy:
[c07-c06-findings-verification.txt](../evidence/c07-c06-findings-verification.txt), souhrn v
[evidence-and-evolution.md § C07](../evidence-and-evolution.md#c07--vypořádání-c06-findings).*

| Finding | ACCEPTED / REJECTED / DEFERRED | Reason/evidence | Action / no-change |
|---|---|---|---|
| F1 | **ACCEPTED** — VERIFIED FINDING | Reprodukováno na `1b3c1fb`: mutant `tstzrange(…, '[]')` v testovací DB přežil 120/120 testů. Implementace je správná (navazující CONFIRMED projdou), chyběl jen důkaz hranice BR-01/BR-02 na autoritativní vrstvě. | Commit `77f235d`: HTTP test „C06 F1 / BR-01+BR-02“ (Confirm 08:30 a 09:30 vedle CONFIRMED 09:00–09:30 → 200, překryv 09:15 → 409) a přímý test sousedních CONFIRMED v `reservation.integration.test.ts`. Mutant `'[]'` je nyní zabit 2 testy (122/124). Owner: Štěpán Rychlý. **Otevřené:** týmové review PR. |
| F2 | **ACCEPTED** — VERIFIED FINDING | `grep -rnwE "decide\|allocate" apps/api/src` → 0 výskytů, docs je uváděly v G2, G3, H1, H2, pod H2 a v důsledcích ADR-007. Rozhodnutí ADR-007 platí, popis byl zastaralý. | Commit `2c0c5b4`: G2/G3/H1/H2 a ADR-007 popisují dva průchody `reservationLifecycle.evaluate`; poznámka o aktualizaci a odkaz na tag `c03-architecture` s původní verzí. Historické sekce J/K ponechány jako záznam C03 commitu. Owner: Štěpán Rychlý. **Otevřené:** týmové review PR. |
| F3 | **ACCEPTED** — VERIFIED FINDING | Reprodukováno na `1b3c1fb`: mutanti M1 (START před stavem) a M2 (okno před STARTem) přežili 72/72 unit testů. Evidence C05 tvrdila víc, než testy prokazovaly. Implementace odpovídá DD-05. | Commit `77f235d`: test C05-12 (3 případy), M1 zabit 1 testem a M2 2 testy. Tabulka testů DD a řádek DD-05 v C05 evidence mají odkaz na opravu. Owner: Štěpán Rychlý. **Otevřené:** týmové review PR. |

Poznámka mimo hodnocení (zastaralý `README.md`): přijato. README byl aktualizován na stav C08 (odkazy na C03, C06, C07/C08,
spuštění na Windows a Node 24).

C04 (Q1–Q3 = N/A): souhlasíme, pokud C04 nebylo týmovým odevzdáním. V baseline `1b3c1fb` žádný C04 artefakt není;
tuto skutečnost uvádíme ve status reportu jako N/A s důvodem, nikoli jako Verified.

---

### Scope check (co jsme záměrně nehodnotili)

Do findings nebylo zařazeno: chybějící produkční autentizace, reálný e-mailový dodavatel, CI, procento coverage, frontend, at-least-once doručení outboxu, provizorní retry parametry, nepoužití Java/Spring. Nic z toho C01–C05 nepožadovalo, nebo to tým sám explicitně uvádí jako vědomé riziko či kompromis (ADR-006, C05 „Remaining design risk“).
