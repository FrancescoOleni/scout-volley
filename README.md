# Scout Volley

Web app (PWA) per lo scout di base della pallavolo: battuta, ricezione, attacco e muro della propria squadra.
Funziona offline e si installa sul telefono Android dalla home.

## Installazione sul telefono

1. Apri il link dell'app con Chrome.
2. Menu ⋮ → **Aggiungi a schermata Home** (o **Installa app**).
3. Da quel momento si apre come un'app e funziona anche senza rete.

Si possono gestire più squadre (tocca il nome della squadra in alto per cambiarla): ognuna ha giocatori, eventi e statistiche separati.

I dati restano solo sul telefono: usa **Squadra → Backup** per esportarli e reimportarli.

## Codici

| Fondamentale | Esiti |
|---|---|
| Battuta | `#` `+` `-` `=` |
| Ricezione | `#+` `-` `/=` |
| Attacco | `#` `+-` `/` `=` |
| Muro | `#` (solo muri vincenti) |

## Pubblicare una nuova versione

Dopo aver modificato i file, aumenta il numero in `CACHE` dentro `sw.js` (es. `scoutvolley-v4`)
e `APP_VERSION` in `app.js` (es. `v4`), altrimenti i telefoni continuano a usare la versione salvata.
La versione installata si legge in fondo alla schermata Squadra.
