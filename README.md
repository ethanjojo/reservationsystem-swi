# BookerDoc

Školní rezervační systém pro termíny u lékařů. Pacient vybere službu a dostupný začátek,
rezervace se automaticky potvrdí a následně se požádá notifikační služba o e-mail.

## Tým a repozitář

**BookerDoc — 3 členové:**

| Člen | GitHub | Role v C01 změně |
| --- | --- | --- |
| Jan Horák | [ethanjojo](https://github.com/ethanjojo) | Autor změny s asistencí Codexu |
| Člen identifikovaný GitHub účtem stepanrychly | [stepanrychly](https://github.com/stepanrychly) | Člen týmu; profil neuvádí veřejné jméno |
| Daniel Krásný | [DanielKrasny](https://github.com/DanielKrasny) | Reviewer před integrací |

[Společný repozitář](https://github.com/ethanjojo/reservationsystem-swi).
Všichni tři mají podle GitHub collaborators API přístup k zápisu (ověřeno 15. 9. 2026).

## Stav C01

Implementováno: Express health endpoint, základ React/shadcn UI, Prisma model a migrace,
repository pro zápis/čtení rezervace, skutečně provedený persistence spike A a automatizované kontroly.

Definováno pro další týdny: vytváření/potvrzování/rušení rezervací, dostupnost, pracovní okna,
pravidlo překryvu, zrušení nejpozději 24 hodin před termínem a notifikační hranice.
**Rezervační API, kompletní UI ani skutečné odesílání e-mailů zatím implementované nejsou.**

- [Project Frame a pravidla](docs/intent-and-change.md)
- [Architektura a rozhodnutí](docs/architecture-and-decisions.md)
- [Evidence spiku a stav všech 15 bodů DoD](docs/evidence-and-evolution.md)
- [Issue C01 engineering spike](https://github.com/ethanjojo/reservationsystem-swi/issues/1)
- [Pull request C01](https://github.com/ethanjojo/reservationsystem-swi/pull/2)

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
npm run typecheck
npm test
npm run build
```

`db:migrate` aplikuje verzované migrace do vývojové DB; `npm test` sám aplikuje stejné migrace
pouze do testovací DB a spustí integrační test. Test vytvoří syntetická data s unikátními UUID,
odpojí zapisujícího klienta a přečte záznam druhým klientem. V `finally` uklidí jen vlastní data.
Nepoužívá reset ani mazání všech tabulek. Není potřeba seed ani externí e-mailový účet.

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
apps/api/tests/                PostgreSQL integrační test
apps/web/src/                  React a shadcn komponenty
scripts/test-db.mjs            Bezpečné spuštění migrace a testu nad testovací DB
docs/                         Project Frame, architektura, evidence
.github/workflows/ci.yml       Typy, build a test proti PostgreSQL
```

## CP1 walking skeleton

**Pouze definice pro C01. Runnable musí být po C03 / před C04.**
Jedna end-to-end cesta (API → databáze → ověřená odpověď):

```text
POST /reservations { patientId, doctorId, serviceId, startsAt }
→ načíst službu a vypočítat endsAt
→ ověřit vlastníka služby, budoucí čas a celé umístění do pracovního okna
→ atomicky potvrdit a uložit CONFIRMED bez překryvu
→ po DB commitu požádat Notification Service o potvrzovací e-mail
→ HTTP 201 { id, status: "CONFIRMED", startsAt, endsAt }
→ automatizovaný HTTP check a načtení uložené rezervace z DB
```

`startsAt` musí být ISO 8601 s offsetem/Z. Časy prezentujeme v Europe/Prague.
CP1 používá syntetického demo pacienta a notifikační stub. Skutečné e-maily přijdou později.
Invalidní vstup: 400; chybějící pacient/lékař/služba: 404; konflikt: 409.
Selhání notifikace nesmí změnit potvrzenou rezervaci ani vrátit chybu samotného vytvoření.

Acceptance checks CP1: platný vstup → 201 a shodný záznam v DB; kolize → 409 bez další rezervace;
dvě souběžné kolidující žádosti → právě jedno potvrzení; navazující intervaly jsou povolené.
V CP1 doplníme pracovní okna a DB exclusion constraint popsaný v architektonickém rozhodnutí.
C01 persistence repository tyto doménové kontroly ještě neposkytuje.

## Change + review smyčka

1. [Issue #1](https://github.com/ethanjojo/reservationsystem-swi/issues/1): C01 engineering spike.
2. Jan Horák s asistencí Codexu připravuje malé commity ve větvi `codex/c01-engineering-spike`.
3. Daniel Krásný zkontroluje PR **před integrací**; použije kontrolní seznam v PR šabloně.
4. Po review tým integruje změnu do `master` a doplní odkaz na review a merge do evidence.

Otevřený PR ani automatické kontroly samy o sobě nesplňují bod reviewed and integrated change.
