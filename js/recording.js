// recording.js - Manages audio recording and speech-to-text transcription
// v2.0-stable - New async-safe saving logic

class RecordingManager {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
        
        // Speech recognition
        this.recognition = null;
        this.speechEnabled = true;
        this.finalTranscript = '';
        
        this.initializeSpeechRecognition();
        console.log('🎙️ Recording Manager initialized');
    }
    
    // Initialize the Web Speech API
    initializeSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.warn('❌ Speech Recognition not supported');
            this.speechEnabled = false;
            window.voiceNotesApp?.uiManager.setSpeechToggleEnabled(false);
            return;
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'it-IT';
        
        // Event handlers
        this.recognition.onstart = () => console.log('✅ Transcription started');
        
        this.recognition.onresult = (event) => this.handleSpeechResult(event);
        
        this.recognition.onerror = (event) => {
            console.error('❌ Transcription error:', event.error);
        };
        
        this.recognition.onend = () => {
            console.log('⏹️ Transcription service ended');
            // This is the final step in the save process
            // Pass the final transcript to the main app
            if (window.voiceNotesApp?.isSaving) {
                window.voiceNotesApp.handleTranscriptionEnd(this.finalTranscript.trim());
            }
        };
        
        console.log('✅ Speech Recognition configured');
    }
    
    // Handle incoming speech results
    handleSpeechResult(event) {
        let interimTranscript = '';
        this.finalTranscript = ''; // Recalculate final transcript from all results

        for (let i = 0; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                this.finalTranscript += transcript + ' ';
            } else {
                interimTranscript += transcript;
            }
        }
        
        this.updateTranscriptionDisplay(this.finalTranscript, interimTranscript);
    }
    
    // Update the UI with the latest transcript
    updateTranscriptionDisplay(finalTxt, interimTxt) {
        window.voiceNotesApp?.uiManager.updateTranscriptionDisplay(finalTxt, interimTxt);
    }
    
    // Toggle speech recognition on/off
    toggleSpeechRecognition() {
        if (!this.recognition) return;
        
        this.speechEnabled = !this.speechEnabled;
        window.voiceNotesApp?.uiManager.setSpeechToggleEnabled(true, this.speechEnabled);
        
        if (this.speechEnabled && window.voiceNotesApp?.isRecording) {
            this.startTranscription();
        } else {
            this.stopTranscription();
        }
    }
    
    // Start audio recording
    async startRecording() {
        console.log('🎙️ Attempting to start recording...');
        
        try {
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            };
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            const options = { mimeType: 'audio/webm;codecs=opus' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                console.warn(`${options.mimeType} not supported, using default.`);
                delete options.mimeType;
            }
            
            this.mediaRecorder = new MediaRecorder(this.stream, options);
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) this.audioChunks.push(event.data);
            };
            
            this.mediaRecorder.onstop = () => {
                console.log('⏹️ MediaRecorder stopped. Processing audio.');
                this.processAudio();
                // Stop the transcription service now that audio is captured
                this.stopTranscription();
            };
            
            this.mediaRecorder.onerror = (event) => {
                console.error('❌ MediaRecorder error:', event.error);
                window.voiceNotesApp?.showError('Recording Error', 'An error occurred during recording.');
            };
            
            this.mediaRecorder.start();
            if (this.speechEnabled) {
                this.startTranscription();
            }
            
            console.log('✅ Recording started successfully');
            return true;
            
        } catch (error) {
            console.error('❌ Error starting recording:', error);
            window.voiceNotesApp?.handleMicrophoneError(error);
            return false;
        }
    }
    
    // Pause recording
    pauseRecording() {
        if (this.mediaRecorder?.state === 'recording') {
            this.mediaRecorder.pause();
            this.stopTranscription(); // Stop listening during pause
            console.log('⏸️ Recording paused');
        }
    }
    
    // Resume recording
    resumeRecording() {
        if (this.mediaRecorder?.state === 'paused') {
            this.mediaRecorder.resume();
            if (this.speechEnabled) this.startTranscription();
            console.log('▶️ Recording resumed');
        }
    }
    
    // Stop recording
    stopRecording() {
        if (this.mediaRecorder?.state !== 'inactive') {
            this.mediaRecorder.stop();
            console.log('⏹️ Stop recording requested');
        }
    }
    
    // Start the transcription service
    startTranscription() {
        if (!this.recognition || !this.speechEnabled) return;
        
        this.finalTranscript = '';
        this.updateTranscriptionDisplay('', '');
        
        try {
            this.recognition.start();
        } catch (e) {
            // May already be started, which is fine.
            console.warn('⚠️ Transcription start warning:', e.message);
        }
    }
    
    // Stop the transcription service
    stopTranscription() {
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {
                console.warn('⚠️ Transcription stop warning:', e.message);
            }
        }
    }
    
    // Process the recorded audio into a blob
    processAudio() {
        if (this.audioChunks.length === 0) {
            console.error('❌ No audio chunks recorded');
            window.voiceNotesApp?.showError('Empty Recording', 'No audio was captured.');
            window.voiceNotesApp?.resetSavingState();
            return;
        }
        
        const audioBlob = new Blob(this.audioChunks, {
            type: this.mediaRecorder.mimeType || 'audio/webm'
        });
        
        console.log('✅ Audio blob created:', { size: audioBlob.size, type: audioBlob.type });
        
        // Pass the blob to the main app, which will wait for the transcript
        window.voiceNotesApp?.handleAudioReady(audioBlob);
    }
    
    // Reset state for a new recording
    reset() {
        this.audioChunks = [];
        this.finalTranscript = '';
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            try { this.mediaRecorder.stop(); } catch (e) {}
        }
        
        this.stopTranscription();
    }
}

// Export globally
window.RecordingManager = RecordingManager;
