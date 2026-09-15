# Rezervační systém pro ordinace

Školní projekt pro rezervaci služeb a termínů u lékařů.

## Zamýšlený rozsah

- Lékař nastavuje pracovní časová okna pro jednotlivé dny týdne.
- Pacient vybírá službu a dostupný čas podle její délky.
- Systém rezervaci automaticky potvrdí a požádá notifikační službu o odeslání e-mailu.
- Potvrzené rezervace stejného lékaře se nesmí překrývat.
- Pacient může rezervaci zrušit nejpozději 24 hodin před jejím začátkem.

## Plánované technologie

- Backend: TypeScript, Express, Prisma a PostgreSQL.
- Frontend: Vite, React a shadcn/ui.

## Stav projektu

Úvodní commit zakládá repozitář. Aplikace zatím není implementovaná.

První pull request pro C01 připraví Project Frame, projektový skeleton
a engineering spike A: uložení rezervace do skutečné databáze a ověřené načtení.
Součástí bude evidence provedení a definice CP1 walking skeletonu.
