// ui.js - Manages all UI updates and user feedback
// v2.2-final - Added modals for review and confirmation

class UIManager {
    constructor() {
        this.elements = {};
        this.initializeElements();
        this.attachModalListeners();
        console.log('🎨 UI Manager initialized');
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
            // New elements
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

    attachModalListeners() {
        this.elements.reviewModalCloseBtn?.addEventListener('click', () => this.hideReviewModal());
    }
    
    updateUI(state) {
        const { isRecording, isPaused, isSaving, isExporting, hasError, speechActive } = state;
        const button = this.elements.recordButton;
        if (!button) return;

        button.className = 'record-button';
        
        if (hasError) {
            button.classList.add('paused'); // Use a neutral color for error
            this.elements.buttonText.textContent = 'Reset';
        } else if (isSaving) {
            button.classList.add('paused');
            this.elements.buttonText.textContent = 'Salvo...';
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

    setSpeechToggleSupported(isSupported) {
        if (!isSupported && this.elements.speechToggle) {
            this.elements.speechToggle.textContent = 'N/D';
            this.elements.speechToggle.disabled = true;
        }
    }
    
    provideFeedback(type = 'tap') {
        if (navigator.vibrate) {
            const patterns = { tap: [10], save: [50], error: [100, 50, 100] };
            navigator.vibrate(patterns[type] || patterns.tap);
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

    // Modal Management
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
            const scope = window.voiceNotesApp.extractScope(note.transcript);
            const isTag = scope.startsWith('tag-');
            const cleanedContent = window.voiceNotesApp.cleanNoteContent(note.transcript);
            return `
                <div class="note-item ${isTag ? 'is-tag' : ''}">
                    <div class="note-header">
                        <span class="note-timestamp">${note.timestamp} (${note.duration}s)</span>
                        <button class="note-delete-btn" data-id="${note.id}">&times;</button>
                    </div>
                    <p class="note-transcript">${cleanedContent || 'Solo audio'}</p>
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

// Export globally
window.UIManager = UIManager;
