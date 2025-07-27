// recording.js - Manages audio recording and speech-to-text transcription
// v2.5 - Stable pause/resume logic

class RecordingManager {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
        this.recognition = null;
        this.speechEnabled = true;
        this.finalTranscript = '';
        this.accumulatedTranscript = '';
        
        this.initializeSpeechRecognition();
    }
    
    initializeSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.speechEnabled = false;
            window.voiceNotesApp?.uiManager.setSpeechToggleSupported(false);
            return;
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'it-IT';
        
        this.recognition.onresult = (event) => this.handleSpeechResult(event);
        this.recognition.onerror = (event) => console.error('❌ Transcription error:', event.error);
        this.recognition.onend = () => {
            if (window.voiceNotesApp?.isSaving) {
                window.voiceNotesApp.handleTranscriptionEnd(this.finalTranscript.trim());
            }
        };
    }
    
    handleSpeechResult(event) {
        let interimTranscript = '';
        let currentFinal = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                currentFinal += transcript;
            } else {
                interimTranscript += transcript;
            }
        }
        this.finalTranscript = (this.accumulatedTranscript + currentFinal).trim();
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
            this.startTranscription(false);
        } else {
            this.stopTranscription();
        }
    }
    
    async startRecording() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            const options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) delete options.mimeType;
            
            this.mediaRecorder = new MediaRecorder(this.stream, options);
            this.audioChunks = [];
            this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.audioChunks.push(e.data); };
            this.mediaRecorder.onstop = () => { this.processAudio(); this.stopTranscription(); };
            this.mediaRecorder.onerror = (e) => window.voiceNotesApp?.showError('Errore Registrazione', e.error.message);
            
            this.mediaRecorder.start();
            if (this.speechEnabled) this.startTranscription(true);
            return true;
        } catch (error) {
            window.voiceNotesApp?.handleMicrophoneError(error);
            return false;
        }
    }
    
    pauseRecording() {
        if (this.mediaRecorder?.state === 'recording') {
            this.accumulatedTranscript = this.finalTranscript + ' ';
            this.mediaRecorder.pause();
            this.stopTranscription();
        }
    }
    
    resumeRecording() {
        if (this.mediaRecorder?.state === 'paused') {
            this.mediaRecorder.resume();
            if (this.speechEnabled) this.startTranscription(false);
        }
    }
    
    stopRecording() {
        if (this.mediaRecorder?.state !== 'inactive') this.mediaRecorder.stop();
    }
    
    startTranscription(isNewRecording) {
        if (!this.recognition || !this.speechEnabled) return;
        if (isNewRecording) {
            this.finalTranscript = '';
            this.accumulatedTranscript = '';
        }
        this.updateTranscriptionDisplay(this.finalTranscript, '');
        try { this.recognition.start(); } catch (e) { /* ignore */ }
    }
    
    stopTranscription() {
        if (this.recognition) { try { this.recognition.stop(); } catch (e) { /* ignore */ } }
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
        if (this.mediaRecorder?.state !== 'inactive') try { this.mediaRecorder.stop(); } catch (e) {}
        this.stopTranscription();
    }
}

window.RecordingManager = RecordingManager;
