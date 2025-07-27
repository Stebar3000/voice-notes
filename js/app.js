// app.js - Applicazione principale Voice Notes Auto
// v2.2-final - Aggiunte gestione sessione e revisione note

class VoiceNotesApp {
    constructor() {
        console.log('🚀 Voice Notes App v2.2-final initialization...');
        
        // State
        this.isRecording = false;
        this.isPaused = false;
        this.isSaving = false;
        this.isExporting = false;
        this.hasError = false;
        this.notes = [];
        this.pendingAudioBlob = null;
        
        // Timing & Click
        this.startTime = null;
        this.elapsedTime = 0;
        this.timerInterval = null;
        this.clickTimeout = null;
        this.doubleClickDelay = 400;

        // Managers
        this.storageManager = new window.StorageManager();
        this.recordingManager = new window.RecordingManager();
        this.uiManager = new window.UIManager();
        
        this.initialize();
    }
    
    async initialize() {
        try {
            if (!this.checkBrowserSupport()) return;
            
            await this.storageManager.initialize();
            await this.loadNotes();
            this.attachEventListeners();
            this.updateUI();
            
            console.log('✅ App fully initialized');
        } catch (error) {
            this.showError('Errore Avvio', 'Impossibile inizializzare l\'app.');
        }
    }
    
    checkBrowserSupport() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showError('Browser Non Supportato', 'Usa Chrome o Safari aggiornati.');
            return false;
        }
        return true;
    }
    
    attachEventListeners() {
        const recordButton = this.uiManager.elements.recordButton;
        
        recordButton.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
        recordButton.addEventListener('touchend', e => {
            e.preventDefault();
            if (this.isSaving || this.isExporting) return;
            this.handleButtonClick();
        });
        // Add click for desktop
        recordButton.addEventListener('click', e => {
             if (this.isSaving || this.isExporting) return;
             // touchend already handles the logic, so on desktop we need a separate path
             // This check prevents double-firing on touch devices that also emulate click
             if (e.sourceCapabilities && !e.sourceCapabilities.firesTouchEvents) {
                this.handleButtonClick();
             }
        });

        // Other controls
        this.uiManager.elements.speechToggle?.addEventListener('click', () => this.recordingManager.toggleSpeechRecognition());
        this.uiManager.elements.exportAggregatedBtn?.addEventListener('click', () => this.exportNotes());
        this.uiManager.elements.newSessionBtn?.addEventListener('click', () => this.startNewSession());
        this.uiManager.elements.reviewNotesBtn?.addEventListener('click', () => this.uiManager.showReviewModal(this.notes));

        // Note deletion (event delegation)
        this.uiManager.elements.notesListContainer?.addEventListener('click', e => {
            if (e.target.classList.contains('note-delete-btn')) {
                const noteId = parseInt(e.target.dataset.id, 10);
                this.deleteNote(noteId);
            }
        });
        
        document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
        console.log('✅ Event listeners attached');
    }
    
    handleButtonClick() {
        if (this.hasError) {
            this.resetErrorState();
            return;
        }
        
        if (this.clickTimeout) {
            clearTimeout(this.clickTimeout);
            this.clickTimeout = null;
            this.handleDoubleClick();
        } else {
            this.clickTimeout = setTimeout(() => {
                this.handleSingleClick();
                this.clickTimeout = null;
            }, this.doubleClickDelay);
        }
    }
    
    handleSingleClick() {
        if (!this.isRecording && !this.isPaused) this.startRecording();
        else if (this.isRecording) this.pauseRecording();
        else if (this.isPaused) this.resumeRecording();
    }
    
    handleDoubleClick() {
        if (this.isRecording || this.isPaused) this.stopAndSaveRecording();
    }
    
    async startRecording() {
        const started = await this.recordingManager.startRecording();
        if (!started) return;
        
        this.isRecording = true;
        this.isPaused = false;
        this.hasError = false;
        this.startTime = Date.now() - this.elapsedTime;
        this.startTimer();
        this.updateUI();
    }
    
    pauseRecording() {
        this.recordingManager.pauseRecording();
        this.isRecording = false;
        this.isPaused = true;
        this.stopTimer();
        this.updateUI();
    }
    
    resumeRecording() {
        this.recordingManager.resumeRecording();
        this.isRecording = true;
        this.isPaused = false;
        this.startTime = Date.now() - this.elapsedTime;
        this.startTimer();
        this.updateUI();
    }
    
    stopAndSaveRecording() {
        if (this.isSaving) return;
        this.isSaving = true;
        this.stopTimer();
        this.updateUI();
        this.recordingManager.stopRecording();
    }

    handleAudioReady(audioBlob) {
        this.pendingAudioBlob = audioBlob;
    }

    async handleTranscriptionEnd(transcript) {
        if (!this.pendingAudioBlob) {
            this.showError("Errore Salvataggio", "Audio non registrato.");
            this.resetSavingState();
            return;
        }
        await this.saveNote(this.pendingAudioBlob, transcript);
        this.resetSavingState();
    }
    
    async saveNote(audioBlob, transcript) {
        const note = {
            id: Date.now(),
            timestamp: new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }),
            duration: Math.floor(this.elapsedTime / 1000),
            size: audioBlob.size,
            transcript: transcript,
            hasTranscript: transcript.length > 0 && this.recordingManager.speechEnabled
        };
        
        const saved = await this.storageManager.saveNote(note, audioBlob);
        this.uiManager.provideFeedback('save');
        this.showStatus(saved ? `✅ Nota salvata!` : `⚠️ Salvataggio fallito.`);
        await this.loadNotes();
        this.resetRecordingState();
        
        setTimeout(() => {
            if (!this.isRecording && !this.isPaused && !this.isSaving) {
                this.showStatus('Pronto per registrare');
            }
        }, 3000);
    }
    
    async loadNotes() {
        this.notes = await this.storageManager.loadNotes();
        console.log(`✅ ${this.notes.length} notes loaded`);
    }

    async exportNotes() {
        if (this.isExporting) return;
        this.isExporting = true;
        this.updateUI();
        try {
            await this.storageManager.exportAggregatedNotes(this.notes);
            this.showStatus('✅ Export completato!');
        } catch (error) {
            console.error("Export failed:", error);
            this.showError("Export Fallito", "Riprova.");
        } finally {
            this.isExporting = false;
            this.updateUI();
            setTimeout(() => this.showStatus('Pronto per registrare'), 3000);
        }
    }

    async startNewSession() {
        const confirmed = await this.uiManager.showConfirmModal(
            "Sei sicuro di voler iniziare una nuova sessione? Tutte le note salvate verranno cancellate in modo permanente."
        );
        if (confirmed) {
            await this.storageManager.clearAllData();
            await this.loadNotes();
            this.uiManager.renderNotesList(this.notes); // Update review modal if open
            this.showStatus("🗑️ Note cancellate. Nuova sessione iniziata.");
        }
    }

    async deleteNote(noteId) {
        const confirmed = await this.uiManager.showConfirmModal(
            "Sei sicuro di voler cancellare questa nota?"
        );
        if (confirmed) {
            await this.storageManager.deleteNote(noteId);
            await this.loadNotes();
            this.uiManager.renderNotesList(this.notes); // Re-render the list in the modal
            this.showStatus("Nota cancellata.");
        }
    }
    
    startTimer() {
        this.timerInterval = setInterval(() => {
            this.elapsedTime = Date.now() - this.startTime;
            this.uiManager.updateTimer(this.elapsedTime);
        }, 100);
    }
    
    stopTimer() { clearInterval(this.timerInterval); }
    
    updateUI() {
        this.uiManager.updateUI({
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            isSaving: this.isSaving,
            isExporting: this.isExporting,
            hasError: this.hasError,
            speechActive: this.recordingManager.speechEnabled
        });
    }
    
    showStatus(message) { this.uiManager.showStatus(message); }
    
    showError(title, description) {
        this.hasError = true;
        this.isSaving = false;
        this.isExporting = false;
        this.uiManager.showError(title, description);
        this.updateUI();
    }
    
    handleMicrophoneError(error) {
        this.uiManager.showMicrophoneError(error);
        this.hasError = true;
        this.updateUI();
    }
    
    resetRecordingState() {
        this.isRecording = false;
        this.isPaused = false;
        this.elapsedTime = 0;
        this.pendingAudioBlob = null;
        this.recordingManager.reset();
        this.uiManager.updateTimer(0);
        this.updateUI();
    }

    resetSavingState() {
        this.isSaving = false;
        this.updateUI();
    }
    
    resetErrorState() {
        this.hasError = false;
        this.showStatus('Pronto per registrare');
        this.updateUI();
    }
    
    handleVisibilityChange() {
        if (document.hidden && this.isRecording) {
            this.pauseRecording();
            this.showStatus('Pausa automatica');
        }
    }
    
    extractScope(transcript) {
        if (!transcript) return 'generale';
        const clean = transcript.trim().toLowerCase();
        const tagMatch = clean.match(/^tag\s+([^\s-]+)/);
        if (tagMatch) return `tag-${tagMatch[1]}`;
        const ambitoMatch = clean.match(/^ambito\s+([^\s]+)/);
        if (ambitoMatch) return ambitoMatch[1];
        return 'generale';
    }
    
    cleanNoteContent(transcript) {
        if (!transcript) return '';
        let clean = transcript.trim();
        clean = clean.replace(/^tag\s+[^\s-]+\s*[-–—]\s*/i, '');
        clean = clean.replace(/^ambito\s+[^\s]+\s+fine\s*/i, '');
        return clean.trim();
    }
}

// Global initialization
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { window.voiceNotesApp = new VoiceNotesApp(); }, 100);
});
