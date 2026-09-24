> Historický podklad C01/CP1. Aktuální C02 chování a vědomé změny kontraktu určuje [baseline v0.2](c02/v02.md).

# Project Frame

## Reservation domain
Rezervace služeb a termínů u lékařů. Resource je konkrétní lékař, nikoli ordinace ani služba.

## Purpose
Pacient si vybere lékaře, službu a dostupný čas bez telefonického objednávání.
Lékař stanoví pracovní okna a systém nabídne časy podle délky služby a již potvrzených rezervací.

## Users / Stakeholders
- Pacient: vytváří a ruší vlastní rezervace.
- Lékař: určuje nabízené služby a týdenní pracovní okna.

## Core concepts
- Resource / Doctor: lékař s identitou a jménem.
- User: pacient s identitou, jménem a e-mailem.
- Reservation: identita, pacient, lékař, služba, začátek, konec a stav.
- Service: název, délka v minutách a lékař, který ji poskytuje.
- WorkingWindow: den týdne, začátek a konec pracovní doby lékaře.

## Core operations
- Create reservation: pacient zvolí službu a budoucí začátek; systém vypočte konec.
- Confirm reservation: automatický přechod po kontrole pracovního okna a konfliktů.
- Cancel reservation: zrušení vlastní rezervace podle pravidla 24 hodin.
- Check availability: vypočtené začátky, při kterých se celá služba vejde do pracovního okna a nekoliduje s potvrzenými rezervacemi.

## Persistent state
Cílový model: User (id, name, email), Doctor (id, name), Service (id, doctorId, name, durationMinutes),
WorkingWindow (id, doctorId, weekday, startMinute, endMinute) a Reservation
(id, patientId, doctorId, serviceId, startsAt, endsAt, status, createdAt).
Pracovní okna používají ISO den týdne 1–7 a minuty od půlnoci v Europe/Prague; okno nepřechází přes půlnoc.
V C01 se ukládají User, Doctor, Service a Reservation. WorkingWindow byl v C01 pouze definován; CP1 již přidává model, migraci a demo seed.
Konec existující rezervace se nemění při změně délky služby.

## State-changing operation
Stavy: DRAFT (návrh, neblokuje čas), CONFIRMED (potvrzeno, blokuje čas), CANCELLED (koncový stav, neblokuje čas).
Přechody: DRAFT → CONFIRMED automaticky, DRAFT → CANCELLED, CONFIRMED → CANCELLED podle pravidla 24 hodin.
Běžné vytvoření a potvrzení proběhne atomicky; API vrátí rovnou CONFIRMED.
Neúspěšné vytvoření nezanechá potvrzenou rezervaci. Zrušené rezervace se nemažou.

## Common business rule
Dvě CONFIRMED rezervace stejného lékaře se nesmí překrývat, ani pokud mají odlišnou službu.
Intervaly jsou polouzavřené [start, end): konec v 10:00 dovoluje další začátek v 10:00.
Konflikt: existing.start < requested.end AND existing.end > requested.start.
Pravidlo musí v CP1 platit i při souběžných požadavcích; C01 persistence spike je neimplementoval; CP1 je vynucuje PostgreSQL exclusion constraintem.

## Domain-specific business rule
Pacient může zrušit CONFIRMED rezervaci, pokud startsAt − aktuální čas ≥ 24 hodin.
Přesně 24 hodin před začátkem je zrušení povoleno; 23 hodin 59 minut před začátkem už ne.
Jde o 24 uplynulých hodin, nikoli o předchozí kalendářní den. DRAFT lze zrušit kdykoli.

## External / system boundary
Notification Service: po potvrzení databázové transakce požádáme službu o potvrzovací e-mail.
Vstup: reservationId, recipient, doctorName, serviceName, startsAt a endsAt.
Výstup: přijetí požadavku nebo chyba. Selhání e-mailu nevrací rezervaci zpět z CONFIRMED.
C01 definoval TypeScript port; CP1 volá lokální stub po DB commitu. Reálné e-maily se neodesílají.

## Assumption
Lékař obsluhuje právě jednoho pacienta současně; není sdílená kapacita více lékařů.

## Unknown
Jak se budou dovolené a jednorázové změny pracovní doby promítat do již potvrzených rezervací?

## Selected future pressure
Category: C — Changeability.

Concrete pressure: přidání jednorázových výjimek z týdenní pracovní doby (dovolená nebo mimořádná ordinace).

Why it is relevant to our reservation system: lékař nemá každý týden stejnou dostupnost;
výjimky budou muset změnit výpočet dostupnosti bez přepisování rezervací a jejich historie.
V C01 se tato pressure neimplementuje.

## Výchozí rozhodnutí pro CP1
- Začátky se generují po 15 minutách od začátku pracovního okna, neukládají se pevné sloty.
- Služba musí celá ležet v jednom pracovním okně a patřit vybranému lékaři.
- V DB jsou časové okamžiky timestamptz; uživatelské časy a pracovní okna jsou Europe/Prague.
- Neexistující místní časy při změně letního času se nenabízejí; opakované časy musí mít explicitní offset.
- Autentizace není součást C01; CP1 používá pouze syntetického demo pacienta.
