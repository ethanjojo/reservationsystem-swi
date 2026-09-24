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
Repository má jen create/findById; C01 business operace nevystavoval. CP1 přidává HTTP use case nad transakčním repository.
Výsledek experimentu a navazující rozhodnutí patří do evidence-and-evolution.md.

## ADR-003 — Čas a souběh (návrh pro CP1)
Reservation uchovává startsAt/endsAt v timestamptz; interval je [start, end).
Služba určuje délku pouze při vytvoření. Resource pro konflikt je Doctor.
CP1 používá PostgreSQL exclusion constraint přes doctorId a tstzrange(startsAt, endsAt, '[)')
s podmínkou status = CONFIRMED a rozšířením btree_gist, aby nešlo potvrdit konflikt souběžně.
V transakci probíhá validace a zápis; porušení pojmenovaného constraintu reservation_no_overlap se převádí na HTTP 409.
Ověřená Prisma 7.10 + pg cesta vrací P2039. Jiné DB chyby se nesmí maskovat jako kolize.
Samostatný SELECT a INSERT bez DB ochrany není dostatečný.
C01 ověřuje pouze persistence round-trip, nikoli souběžné potvrzování.

## ADR-004 — Notification Service (návrh hranice)
Typový port odděluje rezervaci od poskytovatele e-mailu. Volá se až po DB commitu.
Chyba notifikace nesmí zrušit potvrzení; před produkčním provozem je nutné řešit trvalou evidenci
neodeslaných zpráv, opakování a idempotenci. CP1 poskytuje pouze lokální logovací stub, nikoli poskytovatele nebo odesílání e-mailů.

## Rozsah C01 a odložená implementace
C01: dokumentace domény, sestavitelný skeleton, databázová migrace a skutečný persistence test.
CP1 nyní: create/confirm cesta, pracovní okna, kontrola dostupnosti konkrétního požadovaného intervalu, ochrana překryvu a automatizovaný end-to-end check.
Samostatný endpoint pro seznam dostupných začátků přijde v dalším PR společně s formulářem.
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


## ADR-005 — CP1 časová validace a transakce
Každá rezervace začíná na celé minutě, na 15min mřížce relativní k začátku pracovního okna.
Pracovní okna mají celominutové hranice. Validace rozdělí interval na nejvýše 1440 přesných
minutových úseků a ověří, že každý leží ve stejném místním dni a pracovním okně Europe/Prague.
Nejde o přibližné vzorkování: vstup i všechny hranice v této doméně mají minutovou přesnost.
Tím zachytí i návrat hodin, kdy začátek a konec mohou být uvnitř okna, ale část intervalu mimo něj.
Délka služby je skutečně uplynulý čas; používáme Intl a nezávisíme na časové zóně hostitele.

DB transakce validuje reference a pracovní okna a uloží CONFIRMED. Jeden transakční connection
čte reference sekvenčně; souběžné HTTP požadavky si DB vyřeší přes exclusion constraint.
Pracovní dobu/služby CP1 ještě neumí upravovat přes API; při zavedení těchto operací bude nutné
řešit jejich souběh s potvrzováním rezervací. Záměrně nyní neposkytujeme idempotentní retry POST.

Zdroje rozhodnutí: [PostgreSQL range constraints](https://www.postgresql.org/docs/17/rangetypes.html#RANGETYPES-CONSTRAINT),
[Prisma custom check constraints](https://docs.prisma.io/docs/orm/v6/more/troubleshooting/check-constraints).
