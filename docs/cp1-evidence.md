> Historický podklad C01/CP1. Aktuální C02 chování a vědomé změny kontraktu určuje [baseline v0.2](c02/v02.md).

# CP1 — evidence runnable walking skeletonu

## Cíl
POST /reservations → validace → skutečná CONFIRMED rezervace v PostgreSQL bez překryvu
→ notifikační stub po commitu → HTTP 201 → automatizovaná kontrola HTTP i DB.

## Co se provedlo
Dne 15. 9. 2026 na macOS arm64, Node 24.19.0, npm 11.17.0 a PostgreSQL 17.9:
- Vytvořena migrace WorkingWindow a opakovatelný syntetický seed (spuštěn dvakrát).
- Napsány časové testy před implementací: nejprve 7 failed, po implementaci 20 passed.
- Napsány HTTP testy před endpointem: očekávaně selhaly na HTTP 501.
- Přímé DB testy před constraints prokázaly, že bez nich lze uložit kolizi i nulový interval.
- Přidány CHECK a exclusion constraints, transakční use case, strict vstup a HTTP error mapping.
- Reálný běh ukázal, že Prisma 7.10 pro exclusion vrací P2039; specifické mapování je kryté testy.
- Technické review našlo ztrátu submilisekundové přesnosti při konverzi Date. Nový HTTP test
  reprodukoval 201 místo 400; vstup nyní odmítá více než 3 desetinná místa před konverzí.

## Výsledek
`npm test`: **49 passed, 3 test files passed, exit 0**.
[Skutečný výstup testů](evidence/cp1-tests.txt).
`npm run typecheck` a `npm run build`: prošly obě workspaces.
Migrace byly aplikovány do oddělené testovací i vývojové DB.

Ověřeno:
- HTTP 201, vypočtený konec a shodný uložený záznam;
- 400 bez zápisu/notifikace pro neplatný vstup, minulost, jiné pracovní dny, mimo okno a mřížku;
- 404 pro chybějící reference a 400 pro službu jiného lékaře;
- 409 pro kolizi, včetně jiných služeb stejného lékaře;
- dvě skutečné současné HTTP žádosti → právě jedna 201 a jedna 409, právě jedna CONFIRMED;
- sousední intervaly, různí lékaři a neblokující DRAFT/CANCELLED;
- časová zóna Prague v zimě/létě, půlnoc, pauza a oba přechody DST;
- DB ochrana také při přímém zápisu mimo HTTP;
- notifikace vidí commit z jiného DB klienta; její selhání nemění 201 ani CONFIRMED.

## Ruční ověření sestaveného API
API spuštěno příkazem `PORT=3100 npm run start -w @bookerdoc/api`.
POST s demo ID a `2030-02-04T09:00:00+01:00` vrátil:

```json
{
  "http": 201,
  "duplicate": 409,
  "persisted": {
    "status": "CONFIRMED",
    "startsAt": "2030-02-04T08:00:00.000Z",
    "endsAt": "2030-02-04T08:30:00.000Z"
  },
  "id": "c28821d1-bedf-462a-9356-cf72ad618dc9"
}
```

`persisted` je výsledek přímého SQL dotazu druhým pg klientem, nikoli kopie HTTP odpovědi.
Vytvořená demo rezervace byla po ověření smazána podle konkrétního ID; ostatní data zůstala.
Port 3100 byl použit pro smoke test, aby nezasáhl do předchozího procesu na portu 3000.
Reprodukce v README používá výchozí 3000; starý API proces je před novým spuštěním potřeba ukončit.

## Rozsah a zbývající práce
Walking skeleton CP1 je runnable a ověřený. UI rezervací, availability endpoint, rušení,
autentizace a reálné e-maily patří do dalších PR. Stub nedává garanci doručení; outbox/retry
zatím není implementovaný. Není zavedeno idempotentní opakování POST.

Známé čtyři auditní položky řetězce Prisma zaznamenané v C01 zůstávají; tento PR je nemění.
CI používá čistý checkout, PostgreSQL službu a stejné příkazy jako README.

## Change + review
- Výchozí master: `77420bc` — skutečně reviewed a merged C01.
- Větev: `codex/cp1-reservation-flow`.
- Issue: [CP1 runnable reservation flow #3](https://github.com/ethanjojo/reservationsystem-swi/issues/3).
- Autor: Jan Horák s asistencí Codexu.
- Technické review agentem provedeno, nalezená chyba přesnosti opravena a ověřena regresním testem.
- Týmové review a merge nového PR čekají na druhého člena; technické review je nenahrazuje.
