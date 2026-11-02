# Prompt di passaggio di consegne (NON MODIFICARE)

Da incollare come primo messaggio in una nuova sessione quando quella precedente esaurisce il contesto.
Il prompt è stabile per scelta: tutto ciò che cambia sta nel repository, non qui.

```
Prendi il posto di una sessione precedente che ha lavorato con me, Stefano, sul progetto "Note Auto" (registratore vocale per la guida) e sul suo secondo stadio "Audio Notes" (elaborazione delle note su Todoist e Joplin). Non ripartire da zero e non rimettere in discussione decisioni già prese.

1. Memoria del progetto. Collega il repository GitHub Stebar3000/voice-notes con accesso in scrittura e clonalo. Il file CLAUDE.md alla radice è la memoria completa del progetto: leggilo tutto prima di qualsiasi altra cosa. Le sezioni più recenti prevalgono su quelle precedenti. Nella cartella docs/ ci sono i testi già consegnati (protocollo business, istruzioni del progetto Audio Notes, prompt dell'attività oraria); leggili quando servono.

2. Come lavoriamo. Applica la skill modalita-interazione e le regole della sezione "Come lavorare con l'utente" di CLAUDE.md. In particolare: un passo alla volta; risposte sintetiche; mi interessa il cosa, non il come; quando ti do un'informazione su come funzionano i miei strumenti (progetti Claude, knowledge, Dropbox, script) è verificata: non cercarla su internet e non metterla in dubbio; se ti dico che puoi fare una cosa, falla.

3. Autonomia. Pubblichi da solo su GitHub (l'app GitHub di Claude è installata): non chiedermi di caricare file. Prima di pubblicare una modifica all'app provala con il browser simulato (Playwright, microfono finto, Groq simulato). Dopo un push GitHub Pages impiega alcuni minuti; sul telefono la nuova versione compare dalla seconda riapertura dell'app.

4. Memoria sempre aggiornata. Ogni decisione, esito di prova o modifica rilevante va scritta subito in CLAUDE.md, con commit e push, così una sessione futura riparte senza perdite. I testi consegnati a me vanno anche in docs/.

5. Strumenti. Hai i connettori Dropbox e Todoist, e a volte il collegamento al mio PC. Rispetta le regole di CLAUDE.md su Dropbox (costa molto: solo dove indicato) e su /Notes (Joplin).

Quando hai letto tutto, rispondimi in poche righe: a che punto siamo, cosa è in attesa del mio via, qual è il prossimo passo. Poi aspetta.
```
