# Architektura a rozhodnutí

## ADR-001 — Stack a rozdělení projektu
Použijeme TypeScript, Express, Prisma, PostgreSQL, Vite, React a shadcn/ui.
Jde o volbu týmu místo doporučeného Java/Spring stacku: jeden jazyk na obou stranách,
typovaný přístup k datům a relační integrita. Tým si sám zajišťuje podporu, migrace a aktualizace.

Jeden repozitář s npm workspaces: `apps/api` vlastní data a API, `apps/web` vlastní UI.
Frontend neimportuje Prisma klienta a nepřistupuje přímo do DB. C01 UI je pouze statický základ.

## ADR-002 — Persistence spike A
Ověříme uložení a načtení Reservation přes skutečný PostgreSQL. Použijeme Prisma migraci,
nikoli `db push`; generovaný klient nebude verzovaný. Test poběží proti samostatné testovací DB.
Repository má jen create/findById; business operace zatím nejsou veřejným HTTP API.
Výsledek experimentu a navazující rozhodnutí patří do evidence-and-evolution.md.

## ADR-003 — Čas a souběh (návrh pro CP1)
Reservation uchovává startsAt/endsAt v timestamptz; interval je [start, end).
Služba určuje délku pouze při vytvoření. Resource pro konflikt je Doctor.
V CP1 přidáme PostgreSQL exclusion constraint přes doctorId a tstzrange(startsAt, endsAt, '[)')
s podmínkou status = CONFIRMED a rozšířením btree_gist, aby nešlo potvrdit konflikt souběžně.
V transakci proběhne validace a zápis; porušení constraintu se převede na HTTP 409.
Samostatný SELECT a INSERT bez DB ochrany není dostatečný.
C01 ověřuje pouze persistence round-trip, nikoli souběžné potvrzování.

## ADR-004 — Notification Service (návrh hranice)
Typový port odděluje rezervaci od poskytovatele e-mailu. Volá se až po DB commitu.
Chyba notifikace nesmí zrušit potvrzení; před produkčním provozem je nutné řešit trvalou evidenci
neodeslaných zpráv, opakování a idempotenci. C01 neobsahuje poskytovatele ani odesílání e-mailů.

## Rozsah C01 a odložená implementace
C01: dokumentace domény, sestavitelný skeleton, databázová migrace a skutečný persistence test.
CP1: create/confirm cesta, pracovní okna, dostupnost, ochrana překryvu a automatizovaný end-to-end check.
Další týdny: kompletní UI, autentizace, rušení s 24h pravidlem a skutečné e-maily.
Future pressure (výjimky z pracovních oken) je samostatně definována, nyní se neimplementuje.

## Stav závislostí při C01
Zvolena stabilní Prisma 7.10.0; `latest` na npm v době instalace ukazoval Prisma 8 release candidate.
Dne 15. 9. 2026 `npm audit` hlásil 4 high položky v řetězci Prisma CLI:
`deepmerge-ts@7.1.5`, `mysql2@3.15.3` a jejich nadřazené balíčky.
Stejný počet vrátil i `npm audit --omit=dev`; netvrdíme proto čistý production audit.

- [DeepmergeTS — rekurzivní grafy](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)
- [mysql2 — autentizační downgrade](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr)
- [mysql2 — dekomprese protokolu](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3)

`npm ls deepmerge-ts mysql2` je zařadil pod Prisma CLI. C01 používá lokální PostgreSQL
s pg adaptérem a vlastní statickou Prisma konfiguraci; MySQL konektor nepoužívá.
Automatický návrh `npm audit fix --force` je downgrade Prisma na 6.19.3, který by vyžadoval
změnu konfigurace projektu. V C01 neprovádíme neověřený major override tranzitivní knihovny
ani tento downgrade. Před dalším nasazením tým znovu ověří opravenou stabilní Prisma verzi.
