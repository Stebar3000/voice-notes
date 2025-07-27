// app.js - Main application logic
// v2.9 - TEXT-ONLY FINAL VERSION.

class VoiceNotesApp {
    constructor() {
        console.log('🚀 Voice Notes App v2.9 initialization...');
        this.isRecording = false;
        this.isPaused = false;
        this.isSaving = false;
        this.isExporting = false;
        this.hasError = false;
        this.notes = [];
        this.startTime = null;
        this.elapsedTime = 0;
        this.timerInterval = null;
        
        this.clickTimeout = null;
        this.clickCount = 0;
        this.clickDelay = 300;

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
        
        recordButton.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.isSaving || this.isExporting) return;

            this.clickCount++;
            if (this.clickTimeout) clearTimeout(this.clickTimeout);
            
            this.clickTimeout = setTimeout(() => {
                if (this.clickCount === 1) {
                    this.handleSingleClick();
                } else if (this.clickCount >= 2) {
                    this.handleDoubleClick();
                }
                this.clickCount = 0;
            }, this.clickDelay);
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
    
    handleSingleClick() {
        if (this.hasError) { this.resetErrorState(); return; }
        
        if (!this.isRecording && !this.isPaused) this.startRecording();
        else if (this.isRecording) this.pauseRecording();
        else if (this.isPaused) this.resumeRecording();
        
        this.uiManager.provideFeedback('tap');
    }
    
    handleDoubleClick() {
        if (this.isRecording || this.isPaused) {
            this.stopAndSaveRecording();
            this.uiManager.provideFeedback('save');
        }
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
    
    async stopAndSaveRecording() {
        if (this.isSaving) return;
        
        this.isSaving = true;
        this.stopTimer();
        this.updateUI();

        try {
            const { transcript } = await this.recordingManager.stopRecording();
            
            if (!transcript || transcript.trim().length === 0) {
                this.showStatus("Nota vuota, non salvata.");
            } else {
                const note = {
                    id: Date.now(),
                    timestamp: new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }),
                    duration: Math.floor(this.elapsedTime / 1000),
                    transcript: transcript,
                };
                
                const saved = await this.storageManager.saveNote(note);
                if (saved) {
                    this.showStatus("✅ Nota salvata!");
                    await this.loadNotes();
                } else {
                     this.showError("⚠️ Salvataggio fallito", "Controlla la console per dettagli.");
                }
            }
        } catch (error) {
            console.error("Error during save process:", error);
            this.showError("Errore Critico", "Impossibile salvare la nota.");
        } finally {
            this.resetRecordingState();
            this.isSaving = false;
            this.updateUI();
            setTimeout(() => {
                if (!this.isRecording && !this.isPaused && !this.isSaving) {
                    this.showStatus('Pronto per registrare');
                }
            }, 2000);
        }
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
            
            await this.storageManager.downloadFiles([
                { content: markdownContent, filename: `note_aggregate_${dateStr}.md`, type: 'text/markdown' },
                { content: summaryContent, filename: `export_summary_${dateStr}.txt`, type: 'text/plain' }
            ]);
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
            const chunks = this.splitByKeywords(note.transcript);
            chunks.forEach(chunk => {
                if (chunk.trim() === '') return;
                const { scope, content } = this.parseChunk(chunk);
                if (!notesByScope[scope]) {
                    notesByScope[scope] = [];
                }
                notesByScope[scope].push({ content: content, timestamp: note.timestamp });
            });
        });
        return notesByScope;
    }

    generateMarkdown(parsedData) {
        let content = `# Note Vocali Aggregate\nData export: ${new Date().toLocaleString('it-IT')}\n\n`;
        Object.keys(parsedData).sort().forEach(scope => {
            content += `## 📁 AMBITO: ${scope.toUpperCase()}\n\n`;
            parsedData[scope].forEach(item => {
                content += `**Registrato il:** ${item.timestamp}\n> ${item.content}\n\n---\n\n`;
            });
        });
        return content;
    }

    generateSummary(parsedData) {
        let totalItems = 0;
        let content = `Riepilogo Esportazione Note\n`;
        content += `============================\n`;
        content += `Data: ${new Date().toLocaleString('it-IT')}\n\n`;
        content += `Statistiche per Ambito:\n`;
        Object.keys(parsedData).sort().forEach(scope => {
            const items = parsedData[scope];
            totalItems += items.length;
            content += `- ${scope.toUpperCase()}: ${items.length} nota(e)\n`;
        });
        content += `\n----------------------------\n`;
        content += `Totale Voci Registrate: ${totalItems}\n`;
        return content;
    }

    splitByKeywords(text) { return text.split(/(?=ambito |tag )/i); }

    parseChunk(chunk) {
        chunk = chunk.trim();
        const ambitoMatch = chunk.match(/^ambito (.*?) fine/i);
        if (ambitoMatch) {
            return { scope: ambitoMatch[1].trim(), content: chunk.replace(/^ambito .*? fine/i, '').trim() };
        }
        
        const tagMatch = chunk.match(/^tag (.*?)(?:[\s-]+)(.*)/is);
        if (tagMatch) {
            return { scope: 'TAGS', content: `**${tagMatch[1].trim().toUpperCase()}:** ${tagMatch[2].trim()}` };
        }
        
        return { scope: 'GENERALE', content: chunk };
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
        this.stopTimer();
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
        this.recordingManager.reset();
        this.uiManager.updateTimer(0);
        this.uiManager.updateTranscriptionDisplay('', '');
        this.updateUI();
    }
    
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
    window.voiceNotesApp = new VoiceNotesApp();
});
