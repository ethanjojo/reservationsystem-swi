# CP1 — runnable vytvoření a potvrzení rezervace

Schválený rozsah: pracovní okna, POST /reservations, atomické CONFIRMED bez překryvu,
notifikační stub až po commitu, skutečné HTTP/DB testy. Větev codex/cp1-reservation-flow → master.

## Postup a commity
- [ ] Datový model: WorkingWindow (ISO weekday 1–7, minuty 0–1440), migrace, seed syntetických dat.
- [ ] Validace: UUID a ISO okamžik s offsetem, budoucí čas, služba lékaře, minutová délka,
  celá služba v jednom pracovním okně Europe/Prague, začátky po 15 minutách od počátku okna.
- [ ] HTTP use case: 201 + id/stav/časy, 400 chybný vstup/okno, 404 neexistující vazba,
  409 souběžná kolize; PostgreSQL exclusion constraint pro CONFIRMED [start,end).
- [ ] Po commitu notifikační stub; chyba notifikace nemění úspěch rezervace.
- [ ] Testy: úspěch, odmítnuté vstupy, sousední intervaly, různé služby/lékaři/stavy,
  souběh dvou žádostí, časová zóna a změna letního času, ověřená persistence a notifikace.
- [ ] README s demo seedem a curl, evidence, CI, technické review a nové PR.

## Hranice
API je lokální demo bez autentizace se syntetickým pacientem; UI, dostupnostní endpoint,
rušení a skutečné e-maily budou v dalších PR. Pracovní okna se zatím vkládají seedem.
Časy služby mají celé minuty (1–1440); okna jsou v minutách v rámci jednoho místního dne.
Délka služby je skutečně uplynulý čas, včetně změn letního času. Každá minuta musí
ležet ve stejném pracovním okně; přeskočené místní časy nevznikají z instantů, opakované
časy rozlišuje offset vstupu. Návrh neslibuje doručení e-mailu ani idempotentní opakování POST.
