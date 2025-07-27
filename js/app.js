// app.js - Applicazione principale Voice Notes Auto
// v2.4 - Logica di parsing multi-ambito e file di riepilogo

class VoiceNotesApp {
    constructor() {
        console.log('🚀 Voice Notes App v2.4 initialization...');
        this.isRecording = false;
        this.isPaused = false;
        this.isSaving = false;
        this.isExporting = false;
        this.hasError = false;
        this.notes = [];
        this.pendingAudioBlob = null;
        this.startTime = null;
        this.elapsedTime = 0;
        this.timerInterval = null;
        this.clickTimeout = null;
        this.doubleClickDelay = 400;

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
        recordButton.addEventListener('click', e => {
             if (this.isSaving || this.isExporting) return;
             if (e.sourceCapabilities && !e.sourceCapabilities.firesTouchEvents) {
                this.handleButtonClick();
             }
        });

        this.uiManager.elements.speechToggle?.addEventListener('click', () => this.recordingManager.toggleSpeechRecognition());
        this.uiManager.elements.exportAggregatedBtn?.addEventListener('click', () => this.exportNotes());
        this.uiManager.elements.newSessionBtn?.addEventListener('click', () => this.startNewSession());
        this.uiManager.elements.reviewNotesBtn?.addEventListener('click', () => this.uiManager.showReviewModal(this.notes));

        this.uiManager.elements.notesListContainer?.addEventListener('click', e => {
            if (e.target.classList.contains('note-delete-btn')) {
                const noteId = parseInt(e.target.dataset.id, 10);
                this.deleteNote(noteId);
            }
        });
        
        document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
    }
    
    handleButtonClick() {
        if (this.hasError) { this.resetErrorState(); return; }
        
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
        if (!(await this.recordingManager.startRecording())) return;
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

    handleAudioReady(audioBlob) { this.pendingAudioBlob = audioBlob; }

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
    }

    async exportNotes() {
        if (this.isExporting) return;
        if (this.notes.length === 0) {
            this.showStatus("Nessuna nota da esportare.");
            setTimeout(() => this.showStatus('Pronto per registrare'), 2000);
            return;
        }
        this.isExporting = true;
        this.updateUI();

        try {
            const parsedData = this.parseNotesForExport(this.notes);
            const markdownContent = this.generateMarkdown(parsedData);
            const summaryContent = this.generateSummary(parsedData);
            
            const dateStr = new Date().toISOString().slice(0, 10);
            
            const filesToExport = [
                {
                    content: markdownContent,
                    filename: `note_aggregate_${dateStr}.md`,
                    type: 'text/markdown'
                },
                {
                    content: summaryContent,
                    filename: `export_summary_${dateStr}.txt`,
                    type: 'text/plain'
                }
            ];

            await this.storageManager.downloadFiles(filesToExport);
            this.showStatus('✅ Export completato!');
        } catch (error) {
            this.showError("Export Fallito", "Riprova.");
        } finally {
            this.isExporting = false;
            this.updateUI();
            setTimeout(() => this.showStatus('Pronto per registrare'), 3000);
        }
    }

    parseNotesForExport(notes) {
        const notesByScope = {};
        notes.forEach(note => {
            const chunks = note.transcript.split(/(?=ambito |tag )/i);
            chunks.forEach(chunk => {
                if (chunk.trim() === '') return;
                const { scope, content } = this.parseChunk(chunk);
                if (!notesByScope[scope]) {
                    notesByScope[scope] = [];
                }
                notesByScope[scope].push({
                    content: content,
                    timestamp: note.timestamp,
                    duration: note.duration
                });
            });
        });
        return notesByScope;
    }

    generateMarkdown(parsedData) {
        let content = `# Note Vocali Aggregate\n`;
        content += `Data export: ${new Date().toLocaleString('it-IT')}\n\n`;
        
        Object.keys(parsedData).sort().forEach(scope => {
            content += `## 📁 AMBITO: ${scope.toUpperCase()}\n\n`;
            parsedData[scope].forEach(item => {
                content += `**Registrato il:** ${item.timestamp}\n`;
                content += `> ${item.content}\n\n---\n\n`;
            });
        });
        return content;
    }

    generateSummary(parsedData) {
        let totalNotes = 0;
        let totalDuration = 0;
        let content = `Riepilogo Esportazione Note\n`;
        content += `============================\n`;
        content += `Data: ${new Date().toLocaleString('it-IT')}\n\n`;
        
        content += `Statistiche per Ambito:\n`;
        Object.keys(parsedData).sort().forEach(scope => {
            const items = parsedData[scope];
            const scopeDuration = items.reduce((sum, item) => sum + item.duration, 0);
            totalDuration += scopeDuration;
            totalNotes += items.length;
            content += `- ${scope.toUpperCase()}: ${items.length} nota(e), durata totale ${scopeDuration}s\n`;
        });

        content += `\n----------------------------\n`;
        content += `Totale Note: ${totalNotes}\n`;
        content += `Durata Totale Complessiva: ${totalDuration} secondi\n`;

        return content;
    }

    parseChunk(chunk) {
        chunk = chunk.trim();
        const lowerChunk = chunk.toLowerCase();

        if (lowerChunk.startsWith('ambito ')) {
            const match = chunk.match(/ambito\s+([^\s]+)\s+fine\s*(.*)/is);
            if (match) {
                return { scope: match[1].toLowerCase(), content: match[2].trim() };
            }
        }
        
        if (lowerChunk.startsWith('tag ')) {
            const match = chunk.match(/tag\s+([^\s-]+)[\s-–—]+(.*)/is);
            if (match) {
                return { scope: `tag-${match[1].toLowerCase()}`, content: match[2].trim() };
            }
        }
        return { scope: 'generale', content: chunk };
    }

    async startNewSession() {
        const confirmed = await this.uiManager.showConfirmModal("Cancellare tutte le note salvate?");
        if (confirmed) {
            await this.storageManager.clearAllData();
            await this.loadNotes();
            this.uiManager.renderNotesList(this.notes);
            this.showStatus("🗑️ Nuova sessione iniziata.");
        }
    }

    async deleteNote(noteId) {
        const confirmed = await this.uiManager.showConfirmModal("Cancellare questa nota?");
        if (confirmed) {
            await this.storageManager.deleteNote(noteId);
            await this.loadNotes();
            this.uiManager.renderNotesList(this.notes);
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
            isRecording: this.isRecording, isPaused: this.isPaused,
            isSaving: this.isSaving, isExporting: this.isExporting,
            hasError: this.hasError, speechActive: this.recordingManager.speechEnabled
        });
    }
    
    showStatus(message) { this.uiManager.showStatus(message); }
    
    showError(title, description) {
        this.hasError = true; this.isSaving = false; this.isExporting = false;
        this.uiManager.showError(title, description);
        this.updateUI();
    }
    
    handleMicrophoneError(error) {
        this.uiManager.showMicrophoneError(error);
        this.hasError = true;
        this.updateUI();
    }
    
    resetRecordingState() {
        this.isRecording = false; this.isPaused = false; this.elapsedTime = 0;
        this.pendingAudioBlob = null; this.recordingManager.reset();
        this.uiManager.updateTimer(0); this.updateUI();
    }

    resetSavingState() { this.isSaving = false; this.updateUI(); }
    
    resetErrorState() {
        this.hasError = false; this.showStatus('Pronto per registrare'); this.updateUI();
    }
    
    handleVisibilityChange() {
        if (document.hidden && this.isRecording) {
            this.pauseRecording();
            this.showStatus('Pausa automatica');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { window.voiceNotesApp = new VoiceNotesApp(); }, 100);
});
