# C02 — analýza dopadu změny před baseline v0.2

Datum: 2026-09-22. Výchozí neměnný snapshot: `c02-v0.1`, PR #5. Tento dokument se commituje **před** změnou specifikace, schématu a implementace. Požadavek vlastníka: některé zdroje potřebují schválení, lékař může rozhodnutí odložit nebo odmítnout a čekání může vypršet.

## Rozhodnutí a důvody

- `Doctor.requiresApproval` rozlišuje zdroje; výchozí false zachová automatické potvrzení existujících zdrojů.
- Confirm pro takový zdroj vytvoří PENDING_APPROVAL. Čekající žádost neblokuje kapacitu: odložené rozhodnutí nesmí držet termín ostatním. Konflikt se autoritativně řeší až při Approve.
- Pouze lékař vlastnící zdroj může Approve/Reject. Identita pochází ze serverové mapy tokenů; předané doctorId nepřidává oprávnění.
- Platnost čekání je min(čas žádosti + 24 hodin, začátek termínu). Je to zvolená produktová politika, nikoli číselný údaj ze zadání. Vlastník návrh odsouhlasil; tým jej musí potvrdit v review.
- V okamžiku now >= deadline je žádost EXPIRED. Stav se materializuje při autorizovaném čtení či změně; správnost nevyžaduje běžící časovač. Databázový řádek bez interakce může obsahovat historické PENDING_APPROVAL, API jej nikdy nevydává jako platný po deadline.
- Pacient může čekající žádost zrušit do vypršení, také méně než 24 hodin před termínem. Pravidlo 24 h pro již potvrzené rezervace zůstává.

## Dotčené a zachované části

| Oblast | Dopad |
| --- | --- |
| BR-01/02 výlučnost, výpočet času | zachováno: blokuje pouze CONFIRMED; půlotevřený interval, snapshot trvání |
| BR-03 zrušení | rozšíření o platné PENDING_APPROVAL; terminální REJECTED/EXPIRED nelze změnit |
| BR-05/06 identita, konzistence | rozšíření o oprávnění vlastnícího lékaře a souběh Approve/Reject/Cancel/Expire |
| Create, Availability | beze změny požadovaného chování |
| Confirm | větvení podle zdroje; nové deadline a stav; u žádosti bez notifikace |
| Cancel | zrušení čekající žádosti, kontrola vypršení |
| Nové operace | Approve, Reject; pozorovatelná expirace přes Read a při změně |
| Datový model | příznak zdroje, tři enum hodnoty, čas žádosti a deadline; staré řádky zachovány |
| API | přidané approve/reject endpointy a deadline v odpovědi; stávající cesty zachovány |
| Notifikace | až po úspěšném potvrzení/Approve a commitu; odmítnutí ani čekání neposílá potvrzení |
| Diagramy | nový aktér v rozhodnutí, nové stavy a větve, aktualizované activity diagramy |
| Testy | původní sada zůstává pro false; přidat oprávnění, expiry hranici, odmítnutí a souběh |

## Rizika a ověření

Dvě žádosti stejného termínu mohou obě čekat, ale pouze jedna se potvrdí (DB constraint). Změny jednoho řádku se serializují zámkem, čas se odečte až po něm. Materializace EXPIRED musí commitnout i tehdy, když následná požadovaná operace vrátí 409; vyhození výjimky uvnitř transakce by expiraci vrátilo zpět. Opakované schválení nesmí duplikovat email. Testy pokryjí restart aplikace i deadline přesně na hranici.

Migrace doplňuje nullable metadata a default false, neodstraňuje rezervace. V0.1 reprodukujeme z tagu na samostatné databázi; downgrade v0.2 databáze není součástí demonstrace. Produkční autentizace, pracovní kalendář měněný souběžně se schválením, fronta emailů a proaktivní upozornění na expiraci zůstávají vstupy C03.
