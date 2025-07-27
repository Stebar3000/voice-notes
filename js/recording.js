// recording.js - Gestione registrazione audio e trascrizione vocale
// v1.5 - Ottimizzato per mobile e iOS

class RecordingManager {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
        
        // Speech recognition
        this.recognition = null;
        this.speechEnabled = true;
        this.finalTranscript = '';
        this.interimTranscript = '';
        
        // Inizializza speech recognition
        this.initializeSpeechRecognition();
        
        console.log('🎙️ Recording Manager inizializzato');
    }
    
    // Inizializza il riconoscimento vocale
    initializeSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.warn('❌ Speech Recognition non supportato');
            this.speechEnabled = false;
            // Aggiorna UI se necessario
            const toggle = document.getElementById('speechToggle');
            if (toggle) {
                toggle.textContent = '❌ Trascrizione non disponibile';
                toggle.classList.remove('active');
                toggle.disabled = true;
            }
            return;
        }
        
        this.recognition = new SpeechRecognition();
        
        // Configurazione ottimale per note vocali
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'it-IT';
        this.recognition.maxAlternatives = 1;
        
        // Event handlers
        this.recognition.onstart = () => {
            console.log('✅ Trascrizione avviata');
        };
        
        this.recognition.onresult = (event) => {
            this.handleSpeechResult(event);
        };
        
        this.recognition.onerror = (event) => {
            console.error('❌ Errore trascrizione:', event.error);
            if (event.error !== 'no-speech') {
                this.showTranscriptionError(event.error);
            }
        };
        
        this.recognition.onend = () => {
            console.log('⏹️ Trascrizione terminata');
            // Riavvia se stiamo ancora registrando
            if (window.voiceNotesApp?.isRecording && this.speechEnabled) {
                setTimeout(() => {
                    try {
                        this.recognition.start();
                    } catch (e) {
                        console.warn('⚠️ Impossibile riavviare trascrizione:', e);
                    }
                }, 100);
            }
        };
        
        console.log('✅ Speech Recognition configurato');
    }
    
    // Gestisce i risultati della trascrizione
    handleSpeechResult(event) {
        let interim = '';
        let final = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            
            if (event.results[i].isFinal) {
                final += transcript;
            } else {
                interim += transcript;
            }
        }
        
        if (final) {
            this.finalTranscript += final + ' ';
            this.updateTranscriptionDisplay();
        }
        
        this.interimTranscript = interim;
        this.updateTranscriptionDisplay();
    }
    
    // Aggiorna la visualizzazione della trascrizione
    updateTranscriptionDisplay() {
        const area = document.getElementById('transcriptionArea');
        const finalEl = document.getElementById('finalTranscript');
        const interimEl = document.getElementById('interimTranscript');
        
        if (!area || !finalEl || !interimEl) return;
        
        if (area.style.display === 'none') {
            area.style.display = 'block';
        }
        
        finalEl.textContent = this.finalTranscript;
        interimEl.textContent = this.interimTranscript;
        
        // Auto-scroll
        area.scrollTop = area.scrollHeight;
    }
    
    // Mostra errori di trascrizione
    showTranscriptionError(error) {
        let message = '';
        switch (error) {
            case 'network':
                message = 'Errore rete per trascrizione';
                break;
            case 'not-allowed':
                message = 'Microfono bloccato per trascrizione';
                break;
            case 'service-not-allowed':
                message = 'Servizio trascrizione non disponibile';
                break;
            default:
                message = 'Errore trascrizione';
        }
        
        // Mostra brevemente senza interrompere
        const statusEl = document.getElementById('statusText');
        if (statusEl) {
            const originalText = statusEl.textContent;
            statusEl.textContent = message;
            setTimeout(() => {
                if (window.voiceNotesApp && !window.voiceNotesApp.hasError) {
                    statusEl.textContent = originalText;
                }
            }, 3000);
        }
    }
    
    // Toggle trascrizione on/off
    toggleSpeechRecognition() {
        if (!this.recognition) return;
        
        this.speechEnabled = !this.speechEnabled;
        const toggle = document.getElementById('speechToggle');
        
        if (this.speechEnabled) {
            toggle.textContent = '🎤 Trascrizione attiva';
            toggle.classList.add('active');
            
            // Se stiamo registrando, avvia trascrizione
            if (window.voiceNotesApp?.isRecording) {
                this.startTranscription();
            }
        } else {
            toggle.textContent = '🔇 Trascrizione disattiva';
            toggle.classList.remove('active');
            this.stopTranscription();
            
            const area = document.getElementById('transcriptionArea');
            if (area) area.style.display = 'none';
        }
    }
    
    // Avvia la registrazione audio
    async startRecording() {
        console.log('🎙️ Avvio registrazione...');
        
        try {
            // Richiesta microfono con configurazioni ottimali
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 44100,
                    channelCount: 1
                }
            };
            
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('✅ Microfono ottenuto');
            
            // Determina il formato migliore
            const options = {};
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                options.mimeType = 'audio/webm;codecs=opus';
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                options.mimeType = 'audio/mp4';
            }
            console.log('📼 Formato audio:', options.mimeType || 'default');
            
            this.mediaRecorder = new MediaRecorder(this.stream, options);
            this.audioChunks = [];
            
            // Event handlers
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                console.log('⏹️ Registrazione fermata, processo audio...');
                this.processRecording();
                // Chiudi stream
                if (this.stream) {
                    this.stream.getTracks().forEach(track => track.stop());
                    this.stream = null;
                }
            };
            
            this.mediaRecorder.onerror = (event) => {
                console.error('❌ Errore MediaRecorder:', event.error);
                window.voiceNotesApp?.handleRecordingError(event.error);
            };
            
            // Avvia registrazione (chunk ogni secondo)
            this.mediaRecorder.start(1000);
            
            // Avvia trascrizione se abilitata
            if (this.speechEnabled) {
                this.startTranscription();
            }
            
            console.log('✅ Registrazione avviata');
            return true;
            
        } catch (error) {
            console.error('❌ Errore avvio registrazione:', error);
            window.voiceNotesApp?.handleMicrophoneError(error);
            return false;
        }
    }
    
    // Metti in pausa la registrazione
    pauseRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.pause();
            this.stopTranscription();
            console.log('⏸️ Registrazione in pausa');
        }
    }
    
    // Riprendi la registrazione
    resumeRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
            this.mediaRecorder.resume();
            if (this.speechEnabled) {
                this.startTranscription();
            }
            console.log('▶️ Registrazione ripresa');
        }
    }
    
    // Ferma la registrazione
    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            this.stopTranscription();
            console.log('⏹️ Stop registrazione richiesto');
        }
    }
    
    // Avvia trascrizione
    startTranscription() {
        if (!this.recognition || !this.speechEnabled) return;
        
        // Reset trascrizione per nuova registrazione
        this.finalTranscript = '';
        this.interimTranscript = '';
        this.updateTranscriptionDisplay();
        
        try {
            this.recognition.start();
        } catch (e) {
            console.warn('⚠️ Trascrizione già attiva o errore:', e);
        }
    }
    
    // Ferma trascrizione
    stopTranscription() {
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {
                console.warn('⚠️ Errore stop trascrizione:', e);
            }
        }
    }
    
    // Processa la registrazione completata
    processRecording() {
        if (this.audioChunks.length === 0) {
            console.error('❌ Nessun chunk audio');
            window.voiceNotesApp?.showError('Registrazione vuota', 'Riprova a registrare');
            return;
        }
        
        // Crea blob audio
        const audioBlob = new Blob(this.audioChunks, {
            type: this.mediaRecorder.mimeType || 'audio/wav'
        });
        
        console.log('✅ Audio blob creato:', {
            size: audioBlob.size,
            type: audioBlob.type,
            chunks: this.audioChunks.length
        });
        
        // Prepara dati nota
        const noteData = {
            audioBlob: audioBlob,
            transcript: this.finalTranscript.trim().replace(/\s+/g, ' '),
            duration: window.voiceNotesApp?.elapsedTime || 0
        };
        
        // Passa al gestore principale
        window.voiceNotesApp?.saveNote(noteData.audioBlob);
        
        // Reset stato
        this.audioChunks = [];
        this.finalTranscript = '';
        this.interimTranscript = '';
        
        // Nascondi area trascrizione
        const area = document.getElementById('transcriptionArea');
        if (area) area.style.display = 'none';
    }
    
    // Ottieni trascrizione corrente
    getCurrentTranscript() {
        return this.finalTranscript.trim();
    }
    
    // Reset completo
    reset() {
        this.audioChunks = [];
        this.finalTranscript = '';
        this.interimTranscript = '';
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            try {
                this.mediaRecorder.stop();
            } catch (e) {
                console.warn('MediaRecorder già fermato');
            }
        }
        
        this.stopTranscription();
    }
}

// Esporta globalmente
window.RecordingManager = RecordingManager;
