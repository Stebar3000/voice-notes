// recording.js - Manages audio recording and speech-to-text transcription
// v2.9 - TEXT-ONLY FINAL VERSION. Audio blob handling removed.

class RecordingManager {
    constructor() {
        this.mediaRecorder = null;
        this.stream = null;
        this.recognition = null;
        this.speechEnabled = true;
        this.finalTranscript = '';
        
        this.initializeSpeechRecognition();
    }
    
    initializeSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.speechEnabled = false;
            setTimeout(() => window.voiceNotesApp?.uiManager.setSpeechToggleSupported(false), 100);
            return;
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'it-IT';
        
        this.recognition.onresult = (event) => this.handleSpeechResult(event);
        this.recognition.onerror = (event) => {
            if (event.error !== 'network' && event.error !== 'no-speech') {
                console.error('❌ Transcription error:', event.error);
            }
        };
    }
    
    handleSpeechResult(event) {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcriptPart = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
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
    
    async startRecording() {
        try {
            // We still need the stream for the MediaRecorder to run and trigger transcription.
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(this.stream);
            
            // We don't need to listen for data, just start it.
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
                resolve({ transcript: this.finalTranscript.trim() });
                return;
            }
            this.mediaRecorder.onstop = () => {
                resolve({ transcript: this.finalTranscript.trim() });
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
        try { this.recognition.start(); } catch (e) {}
    }
    
    stopTranscription() {
        if (this.recognition) { 
            try { this.recognition.stop(); } catch (e) {} 
        }
    }
    
    reset() {
        this.finalTranscript = '';
        this.stream?.getTracks().forEach(track => track.stop());
        this.stream = null;
        if (this.mediaRecorder?.state !== 'inactive') try { this.mediaRecorder.stop(); } catch (e) {}
        this.stopTranscription();
    }
}

window.RecordingManager = RecordingManager;
