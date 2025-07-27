// storage.js - Gestione persistenza dati e export
// v1.5 - Include fix per iOS usando localStorage come fallback

class StorageManager {
    constructor() {
        this.db = null;
        this.isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        this.storageAvailable = this.checkStorageAvailable();
        console.log('📱 Storage Manager inizializzato', {
            isIOS: this.isIOS,
            storageAvailable: this.storageAvailable
        });
    }
    
    // Verifica quale storage è disponibile
    checkStorageAvailable() {
        const available = {
            indexedDB: !!window.indexedDB,
            localStorage: false,
            sessionStorage: false
        };
        
        // Test localStorage
        try {
            localStorage.setItem('test', 'test');
            localStorage.removeItem('test');
            available.localStorage = true;
        } catch (e) {
            console.warn('localStorage non disponibile');
        }
        
        // Test sessionStorage
        try {
            sessionStorage.setItem('test', 'test');
            sessionStorage.removeItem('test');
            available.sessionStorage = true;
        } catch (e) {
            console.warn('sessionStorage non disponibile');
        }
        
        return available;
    }
    
    // Inizializza database
    async initialize() {
        if (this.isIOS) {
            console.log('📱 iOS rilevato - uso sistema ibrido');
            // Su iOS usiamo localStorage per i metadati
            return this.initializeIOSStorage();
        } else {
            // Su altri dispositivi usa IndexedDB completo
            return this.initializeIndexedDB();
        }
    }
    
    // Sistema storage per iOS
    async initializeIOSStorage() {
        try {
            // Usa localStorage per i metadati delle note
            const notes = this.getIOSNotes();
            console.log(`📱 iOS Storage: ${notes.length} note trovate`);
            return true;
        } catch (error) {
            console.error('❌ Errore inizializzazione iOS storage:', error);
            return false;
        }
    }
    
    // IndexedDB per dispositivi non-iOS
    async initializeIndexedDB() {
        try {
            this.db = await this.openIndexedDB();
            console.log('✅ IndexedDB inizializzato');
            return true;
        } catch (error) {
            console.error('❌ Errore IndexedDB:', error);
            return false;
        }
    }
    
    openIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('VoiceNotesDB', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Store per note
                if (!db.objectStoreNames.contains('notes')) {
                    const notesStore = db.createObjectStore('notes', { keyPath: 'id' });
                    notesStore.createIndex('timestamp', 'timestamp', { unique: false });
                    notesStore.createIndex('scope', 'scope', { unique: false });
                }
                
                // Store per audio blobs
                if (!db.objectStoreNames.contains('audioBlobs')) {
                    db.createObjectStore('audioBlobs', { keyPath: 'noteId' });
                }
            };
        });
    }
    
    // Salva nota - gestisce automaticamente iOS vs altri
    async saveNote(note, audioBlob) {
        if (this.isIOS) {
            return this.saveNoteIOS(note);
        } else {
            return this.saveNoteIndexedDB(note, audioBlob);
        }
    }
    
    // Salvataggio per iOS (solo metadati e trascrizione)
    saveNoteIOS(note) {
        try {
            const notes = this.getIOSNotes();
            
            // Crea oggetto semplificato per iOS
            const iosNote = {
                id: note.id,
                timestamp: note.timestamp,
                duration: note.duration,
                transcript: note.transcript || '',
                hasTranscript: note.hasTranscript,
                scope: window.voiceNotesApp?.extractScope?.(note.transcript) || 'generale',
                size: note.size || 0
            };
            
            notes.unshift(iosNote);
            
            // Mantieni solo ultime 50 note
            if (notes.length > 50) {
                notes.splice(50);
            }
            
            // Salva in localStorage
            localStorage.setItem('voiceNotes_ios', JSON.stringify(notes));
            console.log('📱 Nota salvata in iOS storage');
            
            // IMPORTANTE: Su iOS facciamo export automatico immediato
            if (note.transcript && note.transcript.length > 0) {
                this.autoExportIOS(iosNote);
            }
            
            return true;
        } catch (error) {
            console.error('❌ Errore salvataggio iOS:', error);
            return false;
        }
    }
    
    // Export automatico per iOS dopo ogni nota
    async autoExportIOS(note) {
        console.log('📤 Auto-export iOS per nota:', note.id);
        
        const content = `📝 NOTA VOCALE
Data: ${note.timestamp}
Durata: ${note.duration}s
Ambito: ${note.scope}

${note.transcript}

---
Esportata da Voice Notes Auto`;
        
        // Crea filename
        const date = new Date(note.id);
        const filename = `nota_${date.toISOString().slice(0,19).replace(/[T:]/g,'-')}.txt`;
        
        try {
            const blob = new Blob([content], { type: 'text/plain' });
            const file = new File([blob], filename, { type: 'text/plain' });
            
            if (navigator.share && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: 'Nota Vocale',
                    text: 'Salva questa nota'
                });
                console.log('✅ Auto-export iOS completato');
            } else {
                // Fallback: mostra modal con testo da copiare
                this.showIOSCopyModal(content);
            }
        } catch (error) {
            console.log('⚠️ Auto-export iOS fallito:', error);
            // Mostra modal come fallback
            this.showIOSCopyModal(content);
        }
    }
    
    // Modal per copiare manualmente su iOS
    showIOSCopyModal(content) {
        // Crea modal se non esiste
        let modal = document.getElementById('iosSaveModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'iosSaveModal';
            modal.className = 'ios-save-modal';
            modal.innerHTML = `
                <div class="ios-save-content">
                    <h3>📝 Copia la tua nota</h3>
                    <textarea id="iosSaveTextarea" readonly>${content}</textarea>
                    <div class="ios-save-buttons">
                        <button class="ios-save-btn copy" onclick="window.storageManager.copyIOSText()">
                            📋 Copia
                        </button>
                        <button class="ios-save-btn close" onclick="window.storageManager.closeIOSModal()">
                            ✖️ Chiudi
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            document.getElementById('iosSaveTextarea').value = content;
        }
        
        modal.style.display = 'flex';
        
        // Seleziona automaticamente il testo
        setTimeout(() => {
            const textarea = document.getElementById('iosSaveTextarea');
            textarea.select();
            textarea.setSelectionRange(0, 99999); // Per iOS
        }, 100);
    }
    
    copyIOSText() {
        const textarea = document.getElementById('iosSaveTextarea');
        textarea.select();
        textarea.setSelectionRange(0, 99999);
        
        try {
            document.execCommand('copy');
            window.voiceNotesApp?.showStatus('✅ Testo copiato!');
            setTimeout(() => this.closeIOSModal(), 1000);
        } catch (err) {
            alert('Seleziona e copia manualmente il testo');
        }
    }
    
    closeIOSModal() {
        const modal = document.getElementById('iosSaveModal');
        if (modal) modal.style.display = 'none';
    }
    
    // Recupera note iOS da localStorage
    getIOSNotes() {
        try {
            const stored = localStorage.getItem('voiceNotes_ios');
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Errore lettura iOS notes:', error);
            return [];
        }
    }
    
    // Salvataggio standard con IndexedDB
    async saveNoteIndexedDB(note, audioBlob) {
        if (!this.db) return false;
        
        try {
            const transaction = this.db.transaction(['notes', 'audioBlobs'], 'readwrite');
            
            // Salva metadati
            const noteData = {
                id: note.id,
                timestamp: note.timestamp,
                duration: note.duration,
                transcript: note.transcript,
                hasTranscript: note.hasTranscript,
                scope: window.voiceNotesApp?.extractScope?.(note.transcript) || 'generale',
                size: note.size,
                cleanedTranscript: window.voiceNotesApp?.cleanNoteContent?.(note.transcript, this.extractScope(note.transcript)) || note.transcript,
                saved: new Date().toISOString()
            };
            
            await this.promisifyRequest(transaction.objectStore('notes').put(noteData));
            
            // Salva audio blob
            if (audioBlob) {
                const audioData = {
                    noteId: note.id,
                    blob: audioBlob,
                    type: audioBlob.type,
                    size: audioBlob.size
                };
                await this.promisifyRequest(transaction.objectStore('audioBlobs').put(audioData));
            }
            
            console.log('✅ Nota salvata in IndexedDB');
            return true;
            
        } catch (error) {
            console.error('❌ Errore salvataggio IndexedDB:', error);
            return false;
        }
    }
    
    // Carica tutte le note
    async loadNotes() {
        if (this.isIOS) {
            return this.getIOSNotes();
        } else {
            return this.loadNotesFromDB();
        }
    }
    
    // Carica note da IndexedDB
    async loadNotesFromDB() {
        if (!this.db) return [];
        
        try {
            const transaction = this.db.transaction(['notes'], 'readonly');
            const store = transaction.objectStore('notes');
            const request = store.getAll();
            
            const notes = await this.promisifyRequest(request);
            return notes.sort((a, b) => b.id - a.id);
        } catch (error) {
            console.error('Errore caricamento note:', error);
            return [];
        }
    }
    
    // Export completo
    async exportAllNotes() {
        const notes = await this.loadNotes();
        
        if (notes.length === 0) {
            window.voiceNotesApp?.showStatus('Nessuna nota da esportare');
            return;
        }
        
        const exportData = {
            exported: new Date().toISOString(),
            device: this.isIOS ? 'iOS' : 'Other',
            totalNotes: notes.length,
            appVersion: 'v1.5-modular',
            notes: notes
        };
        
        const filename = `voice_notes_export_${new Date().toISOString().slice(0,10)}.json`;
        
        await this.downloadFile(
            JSON.stringify(exportData, null, 2),
            filename,
            'application/json'
        );
        
        window.voiceNotesApp?.showStatus(`✅ Esportate ${notes.length} note`);
    }
    
    // Export aggregato per ambiti
    async exportAggregatedNotes() {
        const notes = await this.loadNotes();
        
        if (notes.length === 0) {
            window.voiceNotesApp?.showStatus('Nessuna nota da aggregare');
            return;
        }
        
        // Raggruppa per ambito
        const notesByScope = {};
        notes.forEach(note => {
            const scope = note.scope || 'generale';
            if (!notesByScope[scope]) {
                notesByScope[scope] = [];
            }
            notesByScope[scope].push(note);
        });
        
        // Crea markdown
        let content = `# Note Vocali Aggregate\n`;
        content += `Data export: ${new Date().toLocaleDateString('it-IT')}\n`;
        content += `Totale note: ${notes.length}\n\n`;
        
        Object.keys(notesByScope).sort().forEach(scope => {
            content += `## 📁 ${scope.toUpperCase()}\n\n`;
            notesByScope[scope].forEach((note, idx) => {
                content += `### Nota ${idx + 1}\n`;
                content += `📅 ${note.timestamp} - ⏱️ ${note.duration}s\n\n`;
                content += `${note.transcript || '[Solo audio]'}\n\n---\n\n`;
            });
        });
        
        const filename = `note_aggregate_${new Date().toISOString().slice(0,10)}.md`;
        await this.downloadFile(content, filename, 'text/markdown');
        
        window.voiceNotesApp?.showStatus('✅ Export aggregato completato');
    }
    
    // Sistema unificato di download
    async downloadFile(content, filename, type = 'text/plain') {
        const blob = new Blob([content], { type });
        
        // Prova Web Share API (per mobile)
        if (navigator.share && this.isIOS) {
            try {
                const file = new File([blob], filename, { type });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Voice Notes Export'
                    });
                    return true;
                }
            } catch (err) {
                console.log('Web Share fallito:', err);
            }
        }
        
        // Fallback: download classico
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        return true;
    }
    
    // Utility
    promisifyRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    // Conta note salvate
    async getNotesCount() {
        if (this.isIOS) {
            return this.getIOSNotes().length;
        } else if (this.db) {
            try {
                const transaction = this.db.transaction(['notes'], 'readonly');
                const store = transaction.objectStore('notes');
                return await this.promisifyRequest(store.count());
            } catch (error) {
                return 0;
            }
        }
        return 0;
    }
}

// Esporta globalmente per accesso da altri moduli
window.StorageManager = StorageManager;
