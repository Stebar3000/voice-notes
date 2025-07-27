// ui.js - Gestione interfaccia utente e visualizzazione
// v1.5 - Ottimizzato per mobile

class UIManager {
    constructor() {
        this.elements = {};
        this.initializeElements();
        console.log('🎨 UI Manager inizializzato');
    }
    
    // Inizializza riferimenti agli elementi DOM
    initializeElements() {
        this.elements = {
            // Elementi principali
            recordButton: document.getElementById('recordButton'),
            statusText: document.getElementById('statusText'),
            buttonText: document.getElementById('buttonText'),
            timer: document.getElementById('timer'),
            notesList: document.getElementById('notesList'),
            recordingIndicator: document.getElementById('recordingIndicator'),
            
            // Trascrizione
            speechToggle: document.getElementById('speechToggle'),
            transcriptionArea: document.getElementById('transcriptionArea'),
            
            // Export
            exportAllBtn: document.getElementById('exportAllBtn'),
            exportAggregatedBtn: document.getElementById('exportAggregatedBtn'),
            autoSaveStatus: document.getElementById('autoSaveStatus')
        };
        
        // Verifica elementi critici
        const critical = ['recordButton', 'statusText', 'buttonText', 'timer'];
        const missing = critical.filter(key => !this.elements[key]);
        
        if (missing.length > 0) {
            console.error('❌ Elementi DOM mancanti:', missing);
            return false;
        }
        
        return true;
    }
    
    // Aggiorna stato UI in base allo stato dell'app
    updateUI(state) {
        const { isRecording, isPaused, hasError } = state;
        
        // Reset classi
        this.elements.recordButton.className = 'record-button';
        
        if (hasError) {
            this.elements.recordButton.classList.add('error');
            this.elements.buttonText.textContent = 'RIPROVA';
            this.elements.recordingIndicator.style.display = 'none';
        } else if (isRecording) {
            this.elements.recordButton.classList.add('recording');
            this.showStatus('🔴 Registrando...');
            this.elements.buttonText.textContent = 'PAUSA';
            this.elements.recordingIndicator.style.display = 'block';
        } else if (isPaused) {
            this.elements.recordButton.classList.add('paused');
            this.showStatus('⏸️ In pausa - Click per continuare');
            this.elements.buttonText.textContent = 'RIPRENDI';
            this.elements.recordingIndicator.style.display = 'none';
        } else {
            this.elements.recordButton.classList.add('idle');
            this.showStatus('Pronto per registrare');
            this.elements.buttonText.textContent = 'INIZIA';
            this.elements.recordingIndicator.style.display = 'none';
        }
    }
    
    // Mostra messaggio di stato
    showStatus(message) {
        if (this.elements.statusText) {
            this.elements.statusText.textContent = message;
        }
    }
    
    // Mostra errore con titolo e descrizione
    showError(title, description) {
        if (this.elements.statusText) {
            this.elements.statusText.innerHTML = `
                <div style="color: #fca5a5; font-size: 1.2rem;">${title}</div>
                <div style="font-size: 0.9rem; margin-top: 8px; color: #cbd5e1; line-height: 1.3;">${description}</div>
            `;
        }
    }
    
    // Aggiorna timer
    updateTimer(elapsedTime) {
        const totalSeconds = Math.floor(elapsedTime / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        
        if (this.elements.timer) {
            this.elements.timer.textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }
    
    // Visualizza lista note
    displayNotes(notes) {
        if (!this.elements.notesList) return;
        
        this.elements.notesList.innerHTML = '';
        
        // Mostra solo le prime 5 note
        notes.slice(0, 5).forEach(note => {
            const noteElement = this.createNoteElement(note);
            this.elements.notesList.appendChild(noteElement);
        });
    }
    
    // Crea elemento HTML per una nota
    createNoteElement(note) {
        const div = document.createElement('div');
        div.className = 'note-item';
        
        const sizeKB = (note.size / 1024).toFixed(1);
        const transcriptIcon = note.hasTranscript ? '📝' : '🎵';
        const transcriptInfo = note.hasTranscript ? 
            ` • ${note.transcript.split(' ').length} parole` : '';
        
        let html = `
            <div class="note-header">
                <span>${transcriptIcon} Nota ${note.duration}s • ${sizeKB}KB${transcriptInfo}</span>
            </div>
            <div class="note-time">${note.timestamp}</div>
        `;
        
        // Aggiungi trascrizione se disponibile
        if (note.hasTranscript && note.transcript) {
            const scope = window.voiceNotesApp?.extractScope(note.transcript) || 'generale';
            const cleanedText = window.voiceNotesApp?.cleanNoteContent(note.transcript, scope) || note.transcript;
            const preview = cleanedText.length > 100 ? 
                cleanedText.substring(0, 100) + '...' : cleanedText;
            
            html += `
                <div class="note-transcript">
                    ${scope !== 'generale' ? `<strong>[${scope.toUpperCase()}]</strong> ` : ''}
                    ${preview}
                </div>
            `;
        }
        
        // Pulsanti azione
        html += `
            <div class="note-actions">
                <button class="note-btn" onclick="window.voiceNotesApp.playNote(${note.id})">
                    ▶️ Play
                </button>
                <button class="note-btn" onclick="window.voiceNotesApp.exportNote(${note.id})">
                    💾 Export
                </button>
            </div>
        `;
        
        div.innerHTML = html;
        return div;
    }
    
    // Aggiorna stato di salvataggio automatico
    updateAutoSaveStatus(message) {
        if (this.elements.autoSaveStatus) {
            this.elements.autoSaveStatus.textContent = message;
        }
    }
    
    // Mostra/nascondi area trascrizione
    toggleTranscriptionArea(show) {
        if (this.elements.transcriptionArea) {
            this.elements.transcriptionArea.style.display = show ? 'block' : 'none';
        }
    }
    
    // Feedback per dispositivi mobili
    provideFeedback(type = 'tap') {
        // Vibrazione tattile se supportata
        if (navigator.vibrate) {
            switch (type) {
                case 'tap':
                    navigator.vibrate(10);
                    break;
                case 'save':
                    navigator.vibrate([50, 50, 50]);
                    break;
                case 'error':
                    navigator.vibrate([100, 50, 100]);
                    break;
                case 'success':
                    navigator.vibrate([50, 50, 50, 50, 50]);
                    break;
            }
        }
    }
    
    // Gestisce errori del microfono con messaggi user-friendly
    showMicrophoneError(error) {
        let title, description;
        
        switch (error.name) {
            case 'NotAllowedError':
                title = 'Microfono bloccato';
                description = 'Tocca il lucchetto nell\'URL e seleziona "Consenti" per il microfono';
                break;
            case 'NotFoundError':
                title = 'Microfono non trovato';
                description = 'Verifica che il microfono sia collegato e funzionante';
                break;
            case 'NotSupportedError':
                title = 'Browser non supportato';
                description = 'Aggiorna il browser o prova con Chrome/Safari';
                break;
            case 'NotReadableError':
                title = 'Microfono in uso';
                description = 'Chiudi altre app che usano il microfono e riprova';
                break;
            default:
                title = 'Errore microfono';
                description = 'Ricarica la pagina e riprova';
        }
        
        this.showError(title, description);
        this.provideFeedback('error');
    }
    
    // Mostra messaggio temporaneo
    showTemporaryMessage(message, duration = 3000) {
        const originalText = this.elements.statusText.textContent;
        this.showStatus(message);
        
        setTimeout(() => {
            this.showStatus(originalText);
        }, duration);
    }
    
    // Gestisce visibilità della pagina (per risparmio batteria)
    handleVisibilityChange(isPaused) {
        if (document.hidden && !isPaused) {
            this.showStatus('Pausa automatica (app in background)');
        }
    }
    
    // Reset completo UI
    reset() {
        this.updateUI({
            isRecording: false,
            isPaused: false,
            hasError: false
        });
        this.updateTimer(0);
        this.toggleTranscriptionArea(false);
    }
}

// Esporta globalmente
window.UIManager = UIManager;
