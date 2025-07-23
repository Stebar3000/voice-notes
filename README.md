# 🎤 Voice Notes per Auto

Un'applicazione web semplice e sicura per prendere note vocali mentre si guida, progettata specificamente per l'uso hands-free in automobile.

## 🚗 Il Problema

Quando si guida, prendere note è fondamentale ma le app esistenti sono troppo complesse per un uso sicuro alla guida. Serviva un'interfaccia estremamente semplice: un solo pulsante grande per avviare, mettere in pausa, riprendere e salvare le registrazioni vocali.

## ✨ La Soluzione

Un'applicazione web progressiva (PWA) con:
- **Un singolo pulsone** da 300x300px facilmente raggiungibile senza guardare
- **Controllo vocale intuitivo**: click per iniziare/pausa/riprendi, doppio-click per salvare
- **Feedback visivo chiaro** con colori distinti per ogni stato (blu=pronto, rosso=registra, arancione=pausa)
- **Interfaccia ottimizzata** per l'uso in auto con font grandi e contrasti elevati

## 🎯 Come Funziona

1. **Click singolo**: Avvia la registrazione (o mette in pausa se già attiva, o riprende se in pausa)
2. **Doppio-click**: Salva la nota corrente e torna allo stato iniziale
3. **Timer integrato**: Mostra la durata della registrazione in tempo reale
4. **Lista note**: Le ultime 5 registrazioni sono accessibili toccando per riascoltarle

## 🔧 Tecnologie Utilizzate

- **Progressive Web App (PWA)**: Installabile come app nativa su qualsiasi dispositivo
- **Web Audio API**: Per la registrazione audio di alta qualità
- **MediaRecorder API**: Gestione pause/ripresa senza perdita di dati
- **Responsive Design**: Ottimizzata per smartphone, tablet e desktop
- **HTTPS nativo**: Tramite GitHub Pages per piena compatibilità con i browser moderni

## 📱 Installazione

1. Vai su [https://tuonome.github.io/voice-notes](https://tuonome.github.io/voice-notes)
2. Sul tuo smartphone, tocca "Condividi" > "Aggiungi alla schermata Home"
3. L'app si installerà come una normale applicazione
4. Autorizza l'accesso al microfono quando richiesto

## 🚀 Utilizzo in Auto

⚠️ **Sicurezza prima di tutto**: Configura l'app prima di partire. Posiziona il telefono in modo che il pulsante sia facilmente raggiungibile senza distogliere lo sguardo dalla strada.

**Flusso d'uso tipico:**
- Tocca una volta per iniziare a registrare
- Parla liberamente per tutto il tempo necessario
- Tocca una volta per mettere in pausa (ad esempio a un semaforo)
- Tocca di nuovo per riprendere la registrazione
- Tocca due volte rapidamente quando hai finito per salvare la nota

## 🛡️ Privacy e Sicurezza

- **Nessun dato inviato online**: Tutte le registrazioni rimangono sul tuo dispositivo
- **Nessun tracking**: L'app non raccoglie dati personali o di utilizzo
- **HTTPS sicuro**: Connessione crittografata tramite GitHub Pages
- **Codice open source**: Tutto il codice è ispezionabile e modificabile

## 🤝 Contribuire

Questo progetto è nato dall'esigenza reale di avere un'app semplice per le note vocali in auto. Se hai suggerimenti, miglioramenti o hai trovato bug, sentiti libero di:

- Aprire una Issue per segnalazioni
- Proporre miglioramenti tramite Pull Request
- Condividere la tua esperienza d'uso

## 📝 Licenza

MIT License - Sentiti libero di usare, modificare e distribuire questo codice.

## 🙏 Riconoscimenti

Progetto sviluppato con l'assistenza di Claude AI per risolvere un problema reale di user experience nelle applicazioni vocali per automobilisti.

---

**Nota per gli sviluppatori**: Questo è un esempio perfetto di come una PWA possa risolvere problemi specifici che le app native complesse non affrontano adeguatamente. Il codice è intenzionalmente semplice e ben commentato per favorire l'apprendimento e la personalizzazione.# voice-notes
Hands free voice recorder (PWA version)
