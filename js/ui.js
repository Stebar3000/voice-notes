// ui.js - Manages all UI updates and user feedback
// v2.0-stable - Improved layout and state handling

class UIManager {
    constructor() {
        this.elements = {};
        this.initializeElements();
        this.attachModalListeners();
        console.log('🎨 UI Manager initialized');
    }
    
    // Cache all necessary DOM elements
    initializeElements() {
        this.elements = {
            recordButton: document.getElementById('recordButton'),
            statusText: document.getElementById('statusText'),
            buttonText: document.getElementById('buttonText'),
            timer: document.getElementById('timer'),
            recordingIndicator: document.getElementById('recordingIndicator'),
            speechToggle: document.getElementById('speechToggle'),
            transcriptionArea: document.getElementById('transcriptionArea'),
            finalTranscript: document.getElementById('finalTranscript'),
            interimTranscript: document.getElementById('interimTranscript'),
            autoSaveStatus: document.getElementById('autoSaveStatus'),
            // Modal elements
            copyModal: document.getElementById('copyModal'),
            copyTextarea: document.getElementById('copyTextarea'),
            copyModalBtn: document.getElementById('copyModalBtn'),
            closeModalBtn: document.getElementById('closeModalBtn'),
        };
    }

    // Attach listeners for the copy modal
    attachModalListeners() {
        this.elements.copyModalBtn?.addEventListener('click', () => this.copyModalText());
        this.elements.closeModalBtn?.addEventListener('click', () => this.hideCopyModal());
    }
    
    // Update the entire UI based on the app's state
    updateUI(state) {
        const { isRecording, isPaused, isSaving, hasError } = state;
        const button = this.elements.recordButton;
        if (!button) return;

        button.className = 'record-button'; // Reset classes
        
        if (hasError) {
            button.classList.add('error');
            this.elements.buttonText.textContent = 'Reset';
            this.elements.recordingIndicator.style.display = 'none';
        } else if (isSaving) {
            button.classList.add('paused'); // Use paused/orange style for saving
            this.showStatus('Finalizzazione in corso...');
            this.elements.buttonText.textContent = 'Salvo...';
            this.elements.recordingIndicator.style.display = 'none';
        } else if (isRecording) {
            button.classList.add('recording');
            this.showStatus('🔴 Registrando...');
            this.elements.buttonText.textContent = 'Pausa';
            this.elements.recordingIndicator.style.display = 'block';
        } else if (isPaused) {
            button.classList.add('paused');
            this.showStatus('⏸️ In pausa');
            this.elements.buttonText.textContent = 'Riprendi';
            this.elements.recordingIndicator.style.display = 'none';
        } else {
            button.classList.add('idle');
            this.showStatus('Pronto per registrare');
            this.elements.buttonText.textContent = 'Inizia';
            this.elements.recordingIndicator.style.display = 'none';
        }
    }
    
    // Show a message in the main status area
    showStatus(message) {
        if (this.elements.statusText) {
            this.elements.statusText.textContent = message;
        }
    }
    
    // Show a detailed error message
    showError(title, description) {
        if (this.elements.statusText) {
            this.elements.statusText.innerHTML = `
                <div style="color: #fca5a5; font-weight: bold;">${title}</div>
                <div style="font-size: 0.9rem; margin-top: 4px;">${description}</div>
            `;
        }
    }
    
    // Update the timer display
    updateTimer(elapsedTime) {
        const totalSeconds = Math.floor(elapsedTime / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        
        if (this.elements.timer) {
            this.elements.timer.textContent = 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    // Update the transcription display area
    updateTranscriptionDisplay(finalTxt, interimTxt) {
        if (!this.elements.transcriptionArea) return;

        const hasText = finalTxt || interimTxt;
        this.elements.transcriptionArea.style.display = hasText ? 'block' : 'none';

        if (this.elements.finalTranscript) this.elements.finalTranscript.textContent = finalTxt;
        if (this.elements.interimTranscript) this.elements.interimTranscript.textContent = interimTxt;
        
        // Auto-scroll
        this.elements.transcriptionArea.scrollTop = this.elements.transcriptionArea.scrollHeight;
    }
    
    // Update auto-save status message
    updateAutoSaveStatus(message) {
        if (this.elements.autoSaveStatus) {
            this.elements.autoSaveStatus.textContent = message;
        }
    }

    // Update the state of the speech toggle button
    setSpeechToggleEnabled(isSupported, isActive = true) {
        const toggle = this.elements.speechToggle;
        if (!toggle) return;

        if (!isSupported) {
            toggle.textContent = '❌ Trascrizione non supportata';
            toggle.disabled = true;
            toggle.classList.remove('active');
        } else {
            toggle.disabled = false;
            toggle.textContent = isActive ? '🎤 Trascrizione attiva' : '🔇 Trascrizione disattiva';
            toggle.classList.toggle('active', isActive);
        }
    }
    
    // Provide haptic feedback on mobile devices
    provideFeedback(type = 'tap') {
        if (navigator.vibrate) {
            const patterns = {
                tap: [10],
                save: [50, 50, 50],
                error: [100, 50, 100],
            };
            navigator.vibrate(patterns[type] || patterns.tap);
        }
    }
    
    // Show a user-friendly message for microphone errors
    showMicrophoneError(error) {
        const errors = {
            NotAllowedError: ['Microfono bloccato', 'Consenti l\'accesso al microfono nelle impostazioni del browser.'],
            NotFoundError: ['Microfono non trovato', 'Verifica che un microfono sia collegato e funzionante.'],
            NotReadableError: ['Microfono in uso', 'Un\'altra app sta usando il microfono. Chiudila e riprova.'],
        };
        const [title, description] = errors[error.name] || ['Errore Microfono', 'Si è verificato un errore sconosciuto. Ricarica la pagina.'];
        
        this.showError(title, description);
        this.provideFeedback('error');
    }

    // Show the modal for copying text
    showCopyModal(content) {
        if (this.elements.copyModal && this.elements.copyTextarea) {
            this.elements.copyTextarea.value = content;
            this.elements.copyModal.classList.add('show');
        }
    }

    // Hide the modal
    hideCopyModal() {
        this.elements.copyModal?.classList.remove('show');
    }

    // Copy text from the modal's textarea to the clipboard
    copyModalText() {
        if (this.elements.copyTextarea) {
            this.elements.copyTextarea.select();
            this.elements.copyTextarea.setSelectionRange(0, 99999); // For mobile
            
            try {
                document.execCommand('copy');
                this.showStatus('✅ Testo copiato!');
                setTimeout(() => this.hideCopyModal(), 1000);
            } catch (err) {
                this.showError('Copia Fallita', 'Per favore, copia il testo manualmente.');
            }
        }
    }
}

// Export globally
window.UIManager = UIManager;
