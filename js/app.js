// app.js - Applicazione principale Voice Notes Auto
// v2.0-stable - Coordinatore dei moduli con logica di salvataggio asincrona

class VoiceNotesApp {
    constructor() {
        console.log('🚀 Voice Notes App v2.0-stable initialization...');
        
        // Application state
        this.isRecording = false;
        this.isPaused = false;
        this.isSaving = false; // New state for async saving
        this.hasError = false;
        this.notes = [];
        
        // Timing
        this.startTime = null;
        this.elapsedTime = 0;
        this.timerInterval = null;
        
        // Double click handling
        this.lastClickTime = 0;
        this.doubleClickDelay = 400; // ms
        this.clickTimeout = null;

        // State for async save
        this.pendingAudioBlob = null;
        
        // Initialize managers
        this.initializeManagers();
        
        // Initialize the app
        this.initialize();
    }
    
    // Initialize all module managers
    initializeManagers() {
        try {
            this.storageManager = new window.StorageManager();
            this.recordingManager = new window.RecordingManager();
            this.uiManager = new window.UIManager();
            console.log('✅ All managers initialized');
        } catch (error) {
            console.error('❌ Manager initialization error:', error);
            this.showError('Initialization Error', 'Please reload the page');
        }
    }
    
    // Async app initialization
    async initialize() {
        try {
            if (!this.checkBrowserSupport()) return;
            
            await this.storageManager.initialize();
            await this.loadNotes();
            this.attachEventListeners();
            this.updateUI();
            
            console.log('✅ App fully initialized');
            
        } catch (error) {
            console.error('❌ App initialization error:', error);
            this.showError('Startup Error', 'Please try again or contact support');
        }
    }
    
    // Check for browser support for necessary APIs
    checkBrowserSupport() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showError('Browser Not Supported', 'Use an updated version of Chrome, Firefox, or Safari');
            return false;
        }
        return true;
    }
    
    // Attach all event listeners
    attachEventListeners() {
        const recordButton = document.getElementById('recordButton');
        if (!recordButton) {
            console.error('❌ Record button not found');
            return;
        }
        
        // Use 'click' as the primary event for both desktop and mobile
        recordButton.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.isSaving) return; // Prevent actions while saving
            this.handleButtonClick();
        });
        
        // Add haptic feedback on touch start for mobile
        recordButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.isSaving) return;
            this.uiManager.provideFeedback('tap');
        }, { passive: false });

        // Speech recognition toggle
        document.getElementById('speechToggle')?.addEventListener('click', () => {
            this.recordingManager.toggleSpeechRecognition();
        });
        
        // Export buttons
        document.getElementById('exportAggregatedBtn')?.addEventListener('click', () => {
            this.storageManager.exportAggregatedNotes();
        });
        
        // Page visibility handling
        document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
        
        console.log('✅ Event listeners attached');
    }
    
    // Click handler with double-click detection
    handleButtonClick() {
        console.log('🎯 Click detected');
        
        if (this.hasError) {
            this.resetErrorState();
            return;
        }
        
        const currentTime = Date.now();
        
        if (this.clickTimeout) {
            clearTimeout(this.clickTimeout);
            this.clickTimeout = null;
            // Double click detected
            console.log('🎯 Double click');
            this.handleDoubleClick();
            this.lastClickTime = 0;
        } else {
            // Single click action (will be delayed)
            this.clickTimeout = setTimeout(() => {
                console.log('🎯 Single click');
                this.handleSingleClick();
                this.clickTimeout = null;
            }, this.doubleClickDelay);
        }
    }
    
    // Single click: start/pause/resume
    handleSingleClick() {
        if (!this.isRecording && !this.isPaused) {
            this.startRecording();
        } else if (this.isRecording) {
            this.pauseRecording();
        } else if (this.isPaused) {
            this.resumeRecording();
        }
    }
    
    // Double click: stop and save
    handleDoubleClick() {
        if (this.isRecording || this.isPaused) {
            this.stopAndSaveRecording();
        }
    }
    
    // Start recording
    async startRecording() {
        console.log('🎙️ Starting recording...');
        const started = await this.recordingManager.startRecording();
        if (!started) return;
        
        this.isRecording = true;
        this.isPaused = false;
        this.hasError = false;
        this.startTime = Date.now() - this.elapsedTime;
        this.startTimer();
        this.updateUI();
    }
    
    // Pause recording
    pauseRecording() {
        console.log('⏸️ Pausing recording');
        this.recordingManager.pauseRecording();
        this.isRecording = false;
        this.isPaused = true;
        this.stopTimer();
        this.updateUI();
    }
    
    // Resume recording
    resumeRecording() {
        console.log('▶️ Resuming recording');
        this.recordingManager.resumeRecording();
        this.isRecording = true;
        this.isPaused = false;
        this.startTime = Date.now() - this.elapsedTime;
        this.startTimer();
        this.updateUI();
    }
    
    // Stop and save recording (new async flow)
    stopAndSaveRecording() {
        console.log('⏹️ Stopping and saving...');
        if (this.isSaving) return;

        this.isSaving = true;
        this.stopTimer();
        this.updateUI(); // Show "Finalizing..." state

        this.recordingManager.stopRecording();
        // The rest of the process is handled by event callbacks:
        // 1. recordingManager fires onAudioReady
        // 2. recordingManager fires onTranscriptionEnd
        // 3. onTranscriptionEnd calls the final saveNote
    }

    // Called by RecordingManager when audio blob is ready
    handleAudioReady(audioBlob) {
        console.log('Audio blob is ready, waiting for transcript...');
        this.pendingAudioBlob = audioBlob;
    }

    // Called by RecordingManager when transcription is final
    async handleTranscriptionEnd(transcript) {
        console.log('Transcription is final. Proceeding to save.');
        if (!this.pendingAudioBlob) {
            console.error("❌ Transcription ended but no audio blob was ready. Aborting save.");
            this.resetSavingState();
            this.showError("Save Error", "Audio was not recorded correctly.");
            return;
        }

        await this.saveNote(this.pendingAudioBlob, transcript);
        this.resetSavingState();
    }
    
    // Save note data
    async saveNote(audioBlob, transcript) {
        console.log('💾 Saving note...');
        
        const note = {
            id: Date.now(),
            timestamp: new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }),
            duration: Math.floor(this.elapsedTime / 1000),
            size: audioBlob.size,
            transcript: transcript,
            hasTranscript: transcript.length > 0 && this.recordingManager.speechEnabled
        };
        
        // Save to storage (IndexedDB or localStorage)
        const saved = await this.storageManager.saveNote(note, audioBlob);
        
        // Update UI
        this.uiManager.provideFeedback('save');
        if (saved) {
            this.showStatus(`✅ Nota salvata!`);
        } else {
            this.showStatus(`⚠️ Nota non salvata, errore storage.`);
        }
        
        // Refresh notes list in UI
        await this.loadNotes();
        
        // Reset state for next recording
        this.resetRecordingState();
        
        // Revert to default status message after a delay
        setTimeout(() => {
            if (!this.isRecording && !this.isPaused && !this.isSaving) {
                this.showStatus('Pronto per registrare');
            }
        }, 3000);
    }
    
    // Load saved notes from storage
    async loadNotes() {
        const savedNotes = await this.storageManager.loadNotes();
        this.notes = savedNotes.sort((a, b) => b.id - a.id);
        const count = await this.storageManager.getNotesCount();
        this.uiManager.updateAutoSaveStatus(`${count} note nel backup`);
        console.log(`✅ ${this.notes.length} notes loaded`);
    }
    
    // Timer management
    startTimer() {
        this.timerInterval = setInterval(() => {
            this.elapsedTime = Date.now() - this.startTime;
            this.uiManager.updateTimer(this.elapsedTime);
        }, 100);
    }
    
    stopTimer() {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
    }
    
    // Update UI based on app state
    updateUI() {
        this.uiManager.updateUI({
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            isSaving: this.isSaving,
            hasError: this.hasError
        });
    }
    
    // Error and status handling
    showStatus(message) {
        this.uiManager.showStatus(message);
    }
    
    showError(title, description) {
        this.hasError = true;
        this.isSaving = false; // Ensure saving is cancelled on error
        this.uiManager.showError(title, description);
        this.updateUI();
    }
    
    handleMicrophoneError(error) {
        this.uiManager.showMicrophoneError(error);
        this.hasError = true;
        this.updateUI();
    }
    
    // State reset functions
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
    
    // Handle page visibility change
    handleVisibilityChange() {
        if (document.hidden && this.isRecording) {
            this.pauseRecording();
            this.uiManager.showStatus('Pausa automatica (app in background)');
        }
    }
    
    // Utility for extracting scope from transcript
    extractScope(transcript) {
        if (!transcript || transcript.trim().length === 0) return 'generale';
        
        const cleanTranscript = transcript.trim().toLowerCase();
        
        const tagMatch = cleanTranscript.match(/^tag\s+([^\s-]+)/);
        if (tagMatch) return `tag-${tagMatch[1]}`;
        
        const ambitoMatch = cleanTranscript.match(/^ambito\s+([^\s]+)/);
        if (ambitoMatch) return ambitoMatch[1];
        
        return 'generale';
    }
    
    // Utility for cleaning note content
    cleanNoteContent(transcript) {
        if (!transcript || transcript.trim().length === 0) return transcript;
        
        let clean = transcript.trim();
        clean = clean.replace(/^tag\s+[^\s-]+\s*[-–—]\s*/i, '');
        clean = clean.replace(/^ambito\s+[^\s]+\s+fine\s*/i, '');
        
        return clean.trim();
    }
}

// Global initialization
document.addEventListener('DOMContentLoaded', () => {
    // A small delay to ensure all scripts are parsed
    setTimeout(() => {
        try {
            window.voiceNotesApp = new VoiceNotesApp();
        } catch (error) {
            console.error('❌ Critical startup error:', error);
            document.getElementById('statusText').textContent = 'Errore critico - Ricarica la pagina';
        }
    }, 100);
});
