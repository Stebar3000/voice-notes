// recording.js - Manages audio recording and speech-to-text transcription
// v2.2-final - Fixed pause/resume transcript loss

class RecordingManager {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
        
        // Speech recognition
        this.recognition = null;
        this.speechEnabled = true;
        this.finalTranscript = '';
        this.accumulatedTranscript = ''; // Stores transcript during pauses
        
        this.initializeSpeechRecognition();
        console.log('🎙️ Recording Manager initialized');
    }
    
    initializeSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.warn('❌ Speech Recognition not supported');
            this.speechEnabled = false;
            window.voiceNotesApp?.uiManager.setSpeechToggleSupported(false);
            return;
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'it-IT';
        
        this.recognition.onstart = () => console.log('✅ Transcription started');
        this.recognition.onresult = (event) => this.handleSpeechResult(event);
        this.recognition.onerror = (event) => console.error('❌ Transcription error:', event.error);
        
        this.recognition.onend = () => {
            console.log('⏹️ Transcription service ended');
            if (window.voiceNotesApp?.isSaving) {
                window.voiceNotesApp.handleTranscriptionEnd(this.finalTranscript.trim());
            }
        };
    }
    
    handleSpeechResult(event) {
        let interimTranscript = '';
        let currentFinal = '';

        // Rebuild the transcript from the current recognition session
        for (let i = 0; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                currentFinal += transcript + ' ';
            } else {
                interimTranscript += transcript;
            }
        }
        
        // Combine with transcript from before the pause
        this.finalTranscript = (this.accumulatedTranscript + ' ' + currentFinal).trim();
        this.updateTranscriptionDisplay(this.finalTranscript, interimTranscript);
    }
    
    updateTranscriptionDisplay(finalTxt, interimTxt) {
        window.voiceNotesApp?.uiManager.updateTranscriptionDisplay(finalTxt, interimTxt);
    }
    
    toggleSpeechRecognition() {
        if (!this.recognition) return;
        this.speechEnabled = !this.speechEnabled;
        window.voiceNotesApp?.updateUI();
        
        if (this.speechEnabled && window.voiceNotesApp?.isRecording) {
            this.startTranscription(false); // Do not reset when toggling
        } else {
            this.stopTranscription();
        }
    }
    
    async startRecording() {
        try {
            const constraints = { audio: { echoCancellation: true, noiseSuppression: true } };
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            const options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) delete options.mimeType;
            
            this.mediaRecorder = new MediaRecorder(this.stream, options);
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) this.audioChunks.push(event.data);
            };
            
            this.mediaRecorder.onstop = () => {
                this.processAudio();
                this.stopTranscription();
            };
            
            this.mediaRecorder.onerror = (e) => window.voiceNotesApp?.showError('Errore Registrazione', e.error.message);
            
            this.mediaRecorder.start();
            if (this.speechEnabled) this.startTranscription(true); // Is a new recording
            return true;
            
        } catch (error) {
            window.voiceNotesApp?.handleMicrophoneError(error);
            return false;
        }
    }
    
    pauseRecording() {
        if (this.mediaRecorder?.state === 'recording') {
            // Save the current transcript before pausing
            this.accumulatedTranscript = this.finalTranscript;
            this.mediaRecorder.pause();
            this.stopTranscription();
        }
    }
    
    resumeRecording() {
        if (this.mediaRecorder?.state === 'paused') {
            this.mediaRecorder.resume();
            if (this.speechEnabled) this.startTranscription(false); // Not a new recording
        }
    }
    
    stopRecording() {
        if (this.mediaRecorder?.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
    }
    
    startTranscription(isNewRecording) {
        if (!this.recognition || !this.speechEnabled) return;
        
        // Only reset transcripts for a completely new recording
        if (isNewRecording) {
            this.finalTranscript = '';
            this.accumulatedTranscript = '';
        }

        this.updateTranscriptionDisplay(this.finalTranscript, '');
        try { this.recognition.start(); } catch (e) { /* Already started, ignore */ }
    }
    
    stopTranscription() {
        if (this.recognition) {
            try { this.recognition.stop(); } catch (e) { /* Already stopped, ignore */ }
        }
    }
    
    processAudio() {
        if (this.audioChunks.length === 0) {
            window.voiceNotesApp?.showError('Registrazione Vuota', 'Nessun audio catturato.');
            window.voiceNotesApp?.resetSavingState();
            return;
        }
        const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
        window.voiceNotesApp?.handleAudioReady(audioBlob);
    }
    
    reset() {
        this.audioChunks = [];
        this.finalTranscript = '';
        this.accumulatedTranscript = '';
        this.stream?.getTracks().forEach(track => track.stop());
        this.stream = null;
        if (this.mediaRecorder?.state !== 'inactive') {
            try { this.mediaRecorder.stop(); } catch (e) {}
        }
        this.stopTranscription();
    }
}

window.RecordingManager = RecordingManager;
