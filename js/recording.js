// recording.js - Manages audio recording and speech-to-text transcription
// v2.6 - Final fix for transcript overwrite and online/offline race condition.

class RecordingManager {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
        this.recognition = null;
        this.speechEnabled = true;
        
        // This is the main transcript variable. It will be continuously appended to.
        this.finalTranscript = '';
        
        this.initializeSpeechRecognition();
    }
    
    initializeSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.speechEnabled = false;
            // Use a timeout to ensure the UI manager is initialized
            setTimeout(() => window.voiceNotesApp?.uiManager.setSpeechToggleSupported(false), 100);
            return;
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'it-IT';
        
        this.recognition.onresult = (event) => this.handleSpeechResult(event);
        this.recognition.onerror = (event) => {
            // Ignore 'network' errors which can happen when switching modes.
            if (event.error !== 'network') {
                console.error('❌ Transcription error:', event.error);
            }
        };
    }
    
    handleSpeechResult(event) {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcriptPart = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                // *** THE CORE BUG FIX ***
                // Always append the final part to the main transcript string.
                // This prevents overwriting after a pause or a long silence.
                this.finalTranscript += transcriptPart.trim() + ' ';
            } else {
                interimTranscript += transcriptPart;
            }
        }
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
            this.startTranscription();
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
            
            this.mediaRecorder.start();
            if (this.speechEnabled) this.startTranscription();
            return true;
        } catch (error) {
            window.voiceNotesApp?.handleMicrophoneError(error);
            return false;
        }
    }
    
    pauseRecording() {
        if (this.mediaRecorder?.state === 'recording') {
            this.mediaRecorder.pause();
            this.stopTranscription();
        }
    }
    
    resumeRecording() {
        if (this.mediaRecorder?.state === 'paused') {
            this.mediaRecorder.resume();
            if (this.speechEnabled) this.startTranscription();
        }
    }
    
    stopRecording() {
        return new Promise((resolve) => {
            if (this.mediaRecorder?.state === 'inactive' || !this.mediaRecorder) {
                resolve({ audioBlob: null, transcript: this.finalTranscript.trim() });
                return;
            }

            // This new sequence prevents the online/offline race condition.
            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
                resolve({ audioBlob, transcript: this.finalTranscript.trim() });
            };

            this.stopTranscription();
            if (this.mediaRecorder.state === 'recording' || this.mediaRecorder.state === 'paused') {
                this.mediaRecorder.stop();
            }
        });
    }
    
    startTranscription() {
        if (!this.recognition || !this.speechEnabled) return;
        this.updateTranscriptionDisplay(this.finalTranscript, '');
        try { this.recognition.start(); } catch (e) { /* ignore if already started */ }
    }
    
    stopTranscription() {
        if (this.recognition) { 
            try { this.recognition.stop(); } catch (e) { /* ignore if already stopped */ } 
        }
    }
    
    reset() {
        this.audioChunks = [];
        this.finalTranscript = ''; // Reset transcript only for a new recording
        this.stream?.getTracks().forEach(track => track.stop());
        this.stream = null;
        if (this.mediaRecorder?.state !== 'inactive') try { this.mediaRecorder.stop(); } catch (e) {}
        this.stopTranscription();
    }
}

window.RecordingManager = RecordingManager;
