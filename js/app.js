// app.js - Applicazione principale Voice Notes Auto
// v1.5-modular - Coordinatore dei moduli

class VoiceNotesApp {
    constructor() {
        console.log('🚀 Voice Notes App v1.5-modular inizializzazione...');
        
        // Stato dell'applicazione
        this.isRecording = false;
        this.isPaused = false;
        this.hasError = false;
        this.notes = [];
        
        // Timing
        this.startTime = null;
        this.elapsedTime = 0;
        this.timerInterval = null;
        
        // Gestione doppio click
        this.lastClickTime = 0;
        this.doubleClickDelay = 400;
        this.clickTimeout = null;
        
        // Inizializza i manager
        this.initializeManagers();
        
        // Inizializza l'app
        this.initialize();
    }
    
    // Inizializza i manager dei vari moduli
    initializeManagers() {
        try {
            // Storage Manager
            this.storageManager = new window.StorageManager();
            window.storageManager = this.storageManager; // Per accesso globale
            
            // Recording Manager
            this.recordingManager = new window.RecordingManager();
            
            // UI Manager
            this.uiManager = new window.UIManager();
            
            console.log('✅ Tutti i manager inizializzati');
        } catch (error) {
            console.error('❌ Errore inizializzazione manager:', error);
            this.showError('Errore inizializzazione', 'Ricarica la pagina');
        }
    }
    
    // Inizializzazione asincrona
    async initialize() {
        try {
            // Verifica supporto browser
            if (!this.checkBrowserSupport()) {
                return;
            }
            
            // Inizializza storage
            await this.storageManager.initialize();
            
            // Carica note salvate
            await this.loadNotes();
            
            // Collega event listeners
            this.attachEventListeners();
            
            // Aggiorna UI iniziale
            this.updateUI();
            
            console.log('✅ App completamente inizializzata');
            
        } catch (error) {
            console.error('❌ Errore inizializzazione app:', error);
            this.showError('Errore avvio', 'Riprova o contatta supporto');
        }
    }
    
    // Verifica supporto browser
    checkBrowserSupport() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showError('Browser non supportato', 'Usa Chrome, Firefox o Safari aggiornati');
            return false;
        }
        
        // Verifica dispositivi audio disponibili
        navigator.mediaDevices.enumerateDevices()
            .then(devices => {
                const hasAudioInput = devices.some(device => device.kind === 'audioinput');
                if (!hasAudioInput) {
                    console.warn('⚠️ Nessun microfono rilevato');
                }
            })
            .catch(err => {
                console.warn('⚠️ Impossibile verificare dispositivi:', err);
            });
        
        return true;
    }
    
    // Collega tutti gli event listener
    attachEventListeners() {
        const recordButton = document.getElementById('recordButton');
        if (!recordButton) {
            console.error('❌ Pulsante registrazione non trovato');
            return;
        }
        
        // Click principale
        recordButton.addEventListener('click', (e) => {
            e.preventDefault();
            this.handleButtonClick();
        });
        
        // Touch per mobile
        recordButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.uiManager.provideFeedback('tap');
        });
        
        recordButton.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handleButtonClick();
        });
        
        // Previeni comportamenti indesiderati
        recordButton.addEventListener('touchmove', (e) => e.preventDefault());
        recordButton.addEventListener('selectstart', (e) => e.preventDefault());
        
        // Toggle trascrizione
        const speechToggle = document.getElementById('speechToggle');
        if (speechToggle) {
            speechToggle.addEventListener('click', () => {
                this.recordingManager.toggleSpeechRecognition();
            });
        }
        
        // Export buttons
        const exportAllBtn = document.getElementById('exportAllBtn');
        if (exportAllBtn) {
            exportAllBtn.addEventListener('click', () => {
                this.storageManager.exportAllNotes();
            });
        }
        
        const exportAggregatedBtn = document.getElementById('exportAggregatedBtn');
        if (exportAggregatedBtn) {
            exportAggregatedBtn.addEventListener('click', () => {
                this.storageManager.exportAggregatedNotes();
            });
        }
        
        // Gestione visibilità pagina
        document.addEventListener('visibilitychange', () => {
            this.handleVisibilityChange();
        });
        
        console.log('✅ Event listeners collegati');
    }
    
    // Gestione click con rilevamento doppio click
    handleButtonClick() {
        console.log('🎯 Click rilevato');
        
        if (this.hasError) {
            this.resetErrorState();
            return;
        }
        
        const currentTime = Date.now();
        
        // Clear timeout precedente
        if (this.clickTimeout) {
            clearTimeout(this.clickTimeout);
            this.clickTimeout = null;
        }
        
        // Rileva doppio click
        if (currentTime - this.lastClickTime < this.doubleClickDelay) {
            console.log('🎯 Doppio click');
            this.handleDoubleClick();
            this.lastClickTime = 0;
        } else {
            // Aspetta per vedere se arriva un secondo click
            this.clickTimeout = setTimeout(() => {
                console.log('🎯 Click singolo');
                this.handleSingleClick();
                this.clickTimeout = null;
            }, this.doubleClickDelay);
            this.lastClickTime = currentTime;
        }
    }
    
    // Click singolo: start/pause/resume
    handleSingleClick() {
        if (!this.isRecording && !this.isPaused) {
            this.startRecording();
        } else if (this.isRecording) {
            this.pauseRecording();
        } else if (this.isPaused) {
            this.resumeRecording();
        }
    }
    
    // Doppio click: stop e salva
    handleDoubleClick() {
        if (this.isRecording || this.isPaused) {
            this.stopAndSaveRecording();
        }
    }
    
    // Avvia registrazione
    async startRecording() {
        console.log('🎙️ Avvio registrazione');
        
        const started = await this.recordingManager.startRecording();
        if (!started) return;
        
        this.isRecording = true;
        this.isPaused = false;
        this.hasError = false;
        this.startTime = Date.now() - this.elapsedTime;
        this.startTimer();
        this.updateUI();
        
        this.uiManager.provideFeedback('tap');
    }
    
    // Pausa registrazione
    pauseRecording() {
        console.log('⏸️ Pausa registrazione');
        
        this.recordingManager.pauseRecording();
        this.isRecording = false;
        this.isPaused = true;
        this.stopTimer();
        this.updateUI();
    }
    
    // Riprendi registrazione
    resumeRecording() {
        console.log('▶️ Ripresa registrazione');
        
        this.recordingManager.resumeRecording();
        this.isRecording = true;
        this.isPaused = false;
        this.startTime = Date.now() - this.elapsedTime;
        this.startTimer();
        this.updateUI();
    }
    
    // Ferma e salva registrazione
    stopAndSaveRecording() {
        console.log('⏹️ Stop e salvataggio');
        
        this.recordingManager.stopRecording();
        this.isRecording = false;
        this.isPaused = false;
        this.stopTimer();
        // L'UI sarà aggiornata quando il recording manager chiama saveNote
    }
    
    // Salva nota (chiamato dal recording manager)
    async saveNote(audioBlob) {
        console.log('💾 Salvataggio nota...');
        
        const transcript = this.recordingManager.getCurrentTranscript();
        
        const note = {
            id: Date.now(),
            timestamp: new Date().toLocaleString('it-IT', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }),
            duration: Math.floor(this.elapsedTime / 1000),
            audioUrl: URL.createObjectURL(audioBlob),
            size: audioBlob.size,
            transcript: transcript,
            hasTranscript: transcript.length > 0 && this.recordingManager.speechEnabled
        };
        
        // Salva nel database/storage
        const saved = await this.storageManager.saveNote(note, audioBlob);
        
        // Aggiungi alla lista in memoria
        this.notes.unshift(note);
        
        // Mantieni solo le ultime 10 in memoria
        if (this.notes.length > 10) {
            const removed = this.notes.splice(10);
            removed.forEach(n => {
                if (n.audioUrl) URL.revokeObjectURL(n.audioUrl);
            });
        }
        
        // Aggiorna UI
        this.uiManager.displayNotes(this.notes);
        
        // Messaggio di conferma
        if (note.hasTranscript) {
            const wordCount = transcript.split(' ').filter(w => w.length > 0).length;
            const status = saved ? '✓ Salvata' : '⚠️ Solo memoria';
            this.showStatus(`${status} | ${wordCount} parole`);
        } else {
            const status = saved ? '✓ Audio salvato' : '⚠️ Solo memoria';
            this.showStatus(status);
        }
        
        // Aggiorna contatore
        const count = await this.storageManager.getNotesCount();
        this.uiManager.updateAutoSaveStatus(`${count} note salvate`);
        
        // Feedback tattile
        this.uiManager.provideFeedback('save');
        
        // Reset stato
        this.resetState();
        
        // Messaggio normale dopo 3 secondi
        setTimeout(() => {
            if (!this.isRecording && !this.isPaused) {
                this.showStatus('Pronto per registrare');
            }
        }, 3000);
    }
    
    // Carica note salvate
    async loadNotes() {
        const savedNotes = await this.storageManager.loadNotes();
        
        // Converti al formato UI
        this.notes = savedNotes.map(note => ({
            id: note.id,
            timestamp: note.timestamp,
            duration: note.duration,
            transcript: note.transcript || '',
            hasTranscript: note.hasTranscript,
            size: note.size || 0,
            audioUrl: null // Verrà creato on-demand
        }));
        
        // Ordina per più recenti
        this.notes.sort((a, b) => b.id - a.id);
        
        // Mostra in UI
        this.uiManager.displayNotes(this.notes);
        
        if (this.notes.length > 0) {
            console.log(`✅ ${this.notes.length} note caricate`);
            this.uiManager.updateAutoSaveStatus(`${this.notes.length} note recuperate`);
        }
    }
    
    // Timer management
    startTimer() {
        this.timerInterval = setInterval(() => {
            this.elapsedTime = Date.now() - this.startTime;
            this.uiManager.updateTimer(this.elapsedTime);
        }, 100);
    }
    
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }
    
    // Aggiorna UI
    updateUI() {
        this.uiManager.updateUI({
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            hasError: this.hasError
        });
    }
    
    // Gestione errori
    showStatus(message) {
        this.uiManager.showStatus(message);
    }
    
    showError(title, description) {
        this.hasError = true;
        this.uiManager.showError(title, description);
        this.updateUI();
    }
    
    handleMicrophoneError(error) {
        this.uiManager.showMicrophoneError(error);
        this.hasError = true;
        this.updateUI();
    }
    
    handleRecordingError(error) {
        console.error('Errore registrazione:', error);
        this.showError('Errore registrazione', 'Interrompi e riprova');
        this.resetState();
    }
    
    // Reset stati
    resetState() {
        this.elapsedTime = 0;
        this.uiManager.updateTimer(0);
        this.updateUI();
    }
    
    resetErrorState() {
        this.hasError = false;
        this.showStatus('Pronto per registrare');
        this.updateUI();
    }
    
    // Gestione visibilità pagina
    handleVisibilityChange() {
        if (document.hidden && this.isRecording) {
            this.pauseRecording();
            this.uiManager.handleVisibilityChange(true);
        }
    }
    
    // Funzioni per le note
    async playNote(noteId) {
        console.log('▶️ Play nota:', noteId);
        const note = this.notes.find(n => n.id === noteId);
        if (!note) return;
        
        if (!note.audioUrl) {
            this.showStatus('Audio non disponibile');
            return;
        }
        
        const audio = new Audio(note.audioUrl);
        audio.play().catch(err => {
            console.error('Errore riproduzione:', err);
            this.showStatus('Errore riproduzione');
        });
    }
    
    async exportNote(noteId) {
        console.log('💾 Export nota:', noteId);
        // Delegato al storage manager che gestisce il formato
        this.showStatus('Export in corso...');
        // Per ora esporta solo i metadati dalla memoria
        const note = this.notes.find(n => n.id === noteId);
        if (!note) return;
        
        const noteData = {
            metadata: {
                id: note.id,
                timestamp: note.timestamp,
                duration: note.duration,
                hasTranscript: note.hasTranscript,
                exported: new Date().toISOString()
            },
            transcript: note.transcript || ''
        };
        
        const filename = `nota_${note.id}.json`;
        await this.storageManager.downloadFile(
            JSON.stringify(noteData, null, 2),
            filename,
            'application/json'
        );
        
        this.showStatus('✓ Nota esportata');
    }
    
    // Utility per estrazione ambito (usato dai moduli)
    extractScope(transcript) {
        if (!transcript || transcript.trim().length === 0) return 'generale';
        
        const cleanTranscript = transcript.trim().toLowerCase();
        
        // Sistema TAG
        const tagMatch = cleanTranscript.match(/^tag\s+([^\s-]+)\s*[-–—]\s*/);
        if (tagMatch) return tagMatch[1].toLowerCase();
        
        // Sistema AMBITO
        const ambitoMatch = cleanTranscript.match(/^ambito\s+([^\s]+)\s+fine/);
        if (ambitoMatch) return ambitoMatch[1].toLowerCase();
        
        // Pattern comuni
        const patterns = ['urgente', 'importante', 'lavoro', 'famiglia', 'casa'];
        const firstWords = cleanTranscript.split(' ').slice(0, 3).join(' ');
        
        for (const pattern of patterns) {
            if (firstWords.includes(pattern)) return pattern;
        }
        
        return 'generale';
    }
    
    // Pulisci contenuto nota
    cleanNoteContent(transcript, scope) {
        if (!transcript || transcript.trim().length === 0) return transcript;
        
        const cleanTranscript = transcript.trim();
        
        // Rimuovi TAG
        const tagCleaned = cleanTranscript.replace(/^tag\s+[^\s-]+\s*[-–—]\s*/i, '');
        if (tagCleaned !== cleanTranscript) return tagCleaned;
        
        // Rimuovi AMBITO
        const ambitoCleaned = cleanTranscript.replace(/^ambito\s+[^\s]+\s+fine\s*/i, '');
        if (ambitoCleaned !== cleanTranscript) return ambitoCleaned;
        
        return cleanTranscript;
    }
}

// Inizializzazione globale quando il DOM è pronto
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM pronto - inizializzo Voice Notes App');
    
    // Piccolo delay per sicurezza
    setTimeout(() => {
        try {
            window.voiceNotesApp = new VoiceNotesApp();
            console.log('🎉 App avviata con successo!');
        } catch (error) {
            console.error('❌ Errore critico:', error);
            const statusEl = document.getElementById('statusText');
            if (statusEl) {
                statusEl.textContent = 'Errore avvio - Ricarica pagina';
            }
        }
    }, 100);
});

// Fallback se DOM già caricato
if (document.readyState !== 'loading') {
    console.log('📄 DOM già caricato - avvio immediato');
    setTimeout(() => {
        if (!window.voiceNotesApp) {
            try {
                window.voiceNotesApp = new VoiceNotesApp();
            } catch (error) {
                console.error('❌ Errore fallback:', error);
            }
        }
    }, 50);
}
