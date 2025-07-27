// ui.js - Manages all UI updates and user feedback
// v3.2 - Added audio feedback using Tone.js

class UIManager {
    constructor() {
        this.elements = {};
        this.synth = null;
        this.initializeElements();
        this.attachModalListeners();
        this.initializeAudio();
    }
    
    initializeElements() {
        this.elements = {
            recordButton: document.getElementById('recordButton'),
            statusText: document.getElementById('statusText'),
            buttonText: document.getElementById('buttonText'),
            timer: document.getElementById('timer'),
            recordingIndicator: document.getElementById('recordingIndicator'),
            speechToggle: document.getElementById('speechToggle'),
            exportAggregatedBtn: document.getElementById('exportAggregatedBtn'),
            transcriptionArea: document.getElementById('transcriptionArea'),
            finalTranscript: document.querySelector('#transcriptionArea #finalTranscript'),
            interimTranscript: document.querySelector('#transcriptionArea #interimTranscript'),
            newSessionBtn: document.getElementById('newSessionBtn'),
            reviewNotesBtn: document.getElementById('reviewNotesBtn'),
            reviewModal: document.getElementById('reviewModal'),
            reviewModalCloseBtn: document.getElementById('reviewModalCloseBtn'),
            notesListContainer: document.getElementById('notesListContainer'),
            confirmModal: document.getElementById('confirmModal'),
            confirmModalText: document.getElementById('confirmModalText'),
            confirmOkBtn: document.getElementById('confirmOkBtn'),
            confirmCancelBtn: document.getElementById('confirmCancelBtn'),
        };
    }

    initializeAudio() {
        // Initialize the synthesizer only after a user interaction
        const initialize = () => {
            if (window.Tone && !this.synth) {
                this.synth = new Tone.Synth().toDestination();
                console.log('Audio context started.');
            }
            // Remove the event listener after it has run once
            document.body.removeEventListener('click', initialize);
            document.body.removeEventListener('touchend', initialize);
        };
        // The audio context can only be started by a user gesture.
        document.body.addEventListener('click', initialize, { once: true });
        document.body.addEventListener('touchend', initialize, { once: true });
    }

    attachModalListeners() {
        this.elements.reviewModalCloseBtn?.addEventListener('click', () => this.hideReviewModal());
    }
    
    updateUI(state) {
        const { isRecording, isPaused, isSaving, isExporting, hasError, speechActive } = state;
        const button = this.elements.recordButton;
        if (!button) return;

        button.className = 'record-button';
        
        if (hasError) {
            button.classList.add('paused');
            this.elements.buttonText.textContent = 'Reset';
        } else if (isSaving) {
            button.classList.add('paused');
            this.elements.buttonText.textContent = 'Salvataggio...';
        } else if (isExporting) {
            button.classList.add('paused');
            this.elements.buttonText.textContent = 'Export...';
        } else if (isRecording) {
            button.classList.add('recording');
            this.showStatus('🔴 Registrando...');
            this.elements.buttonText.textContent = 'Pausa';
        } else if (isPaused) {
            button.classList.add('paused');
            this.showStatus('⏸️ In pausa');
            this.elements.buttonText.textContent = 'Riprendi';
        } else {
            button.classList.add('idle');
            this.showStatus('Pronto per registrare');
            this.elements.buttonText.textContent = 'Inizia';
        }

        this.elements.recordingIndicator.style.display = isRecording ? 'block' : 'none';
        this.elements.speechToggle?.classList.toggle('active', speechActive);
    }
    
    showStatus(message) { this.elements.statusText.textContent = message; }
    
    showError(title, description) {
        this.elements.statusText.innerHTML = `
            <div style="color: #fca5a5; font-weight: bold;">${title}</div>
            <div style="font-size: 0.9rem; margin-top: 4px;">${description}</div>
        `;
    }
    
    updateTimer(elapsedTime) {
        const totalSeconds = Math.floor(elapsedTime / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        this.elements.timer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    updateTranscriptionDisplay(finalTxt, interimTxt) {
        if (!this.elements.transcriptionArea) return;
        const hasText = finalTxt || interimTxt;
        this.elements.transcriptionArea.style.display = hasText ? 'block' : 'none';
        if (this.elements.finalTranscript) this.elements.finalTranscript.textContent = finalTxt;
        if (this.elements.interimTranscript) this.elements.interimTranscript.textContent = interimTxt;
        this.elements.transcriptionArea.scrollTop = this.elements.transcriptionArea.scrollHeight;
    }
    
    playAudioFeedback(type) {
        if (!this.synth) return;

        const now = Tone.now();
        switch (type) {
            case 'start':
                this.synth.triggerAttackRelease("C5", "8n", now); // High C for start/resume
                break;
            case 'pause':
                this.synth.triggerAttackRelease("G4", "8n", now); // Lower G for pause
                break;
            case 'save':
                // A quick, positive two-note sequence for save
                this.synth.triggerAttackRelease("C5", "8n", now);
                this.synth.triggerAttackRelease("G5", "8n", now + 0.1);
                break;
            case 'error':
                this.synth.triggerAttackRelease("A2", "4n", now); // Low, dissonant sound for error
                break;
        }
    }

    provideFeedback(type = 'tap') {
        // Play audio feedback
        this.playAudioFeedback(type);

        // Also provide haptic feedback if available
        if (navigator.vibrate) {
            const patterns = { 
                start: [50], 
                pause: [20],
                save: [80], 
                error: [100, 50, 100] 
            };
            navigator.vibrate(patterns[type] || [10]);
        }
    }
    
    showMicrophoneError(error) {
        const errors = {
            NotAllowedError: ['Microfono bloccato', 'Consenti l\'accesso nelle impostazioni.'],
            NotFoundError: ['Microfono non trovato', 'Verifica che sia collegato.'],
            NotReadableError: ['Microfono in uso', 'Un\'altra app lo sta usando.'],
        };
        const [title, description] = errors[error.name] || ['Errore Microfono', 'Ricarica la pagina.'];
        this.showError(title, description);
    }

    showReviewModal(notes) {
        this.renderNotesList(notes);
        this.elements.reviewModal?.classList.add('show');
    }

    hideReviewModal() {
        this.elements.reviewModal?.classList.remove('show');
    }

    renderNotesList(notes) {
        const container = this.elements.notesListContainer;
        if (!container) return;

        if (notes.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-dark);">Nessuna nota salvata.</p>';
            return;
        }

        container.innerHTML = notes.map(note => {
            const chunks = note.transcript.split(/(?=ambito |tag )/i);
            const contentHTML = chunks.map(chunk => {
                if (chunk.trim() === '') return '';
                const { scope, content } = window.voiceNotesApp.parseChunk(chunk);
                const isTag = scope === 'TAGS';
                return `<div class="note-item ${isTag ? 'is-tag' : ''}"><p class="note-transcript">${content || 'Contenuto vuoto'}</p></div>`;
            }).join('');

            return `
                <div class="note-group">
                    <div class="note-group-header">
                        <span class="note-timestamp">${note.timestamp} (${note.duration}s)</span>
                        <button class="note-delete-btn" data-id="${note.id}">&times;</button>
                    </div>
                    ${contentHTML}
                </div>
            `;
        }).join('');
    }

    showConfirmModal(text) {
        return new Promise(resolve => {
            this.elements.confirmModalText.textContent = text;
            this.elements.confirmModal.classList.add('show');

            const okListener = () => {
                this.elements.confirmModal.classList.remove('show');
                cleanup();
                resolve(true);
            };
            const cancelListener = () => {
                this.elements.confirmModal.classList.remove('show');
                cleanup();
                resolve(false);
            };
            const cleanup = () => {
                this.elements.confirmOkBtn.removeEventListener('click', okListener);
                this.elements.confirmCancelBtn.removeEventListener('click', cancelListener);
            };

            this.elements.confirmOkBtn.addEventListener('click', okListener, { once: true });
            this.elements.confirmCancelBtn.addEventListener('click', cancelListener, { once: true });
        });
    }
}

window.UIManager = UIManager;
