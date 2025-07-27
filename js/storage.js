// storage.js - Manages data persistence (IndexedDB/localStorage) and export
// v2.0-stable - Simplified and more robust logic

class StorageManager {
    constructor() {
        this.db = null;
        this.isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        this.dbName = 'VoiceNotesDB';
        this.dbVersion = 1;
        this.notesStoreName = 'notes';
        this.audioStoreName = 'audioBlobs';

        console.log('📱 Storage Manager initialized', { isIOS: this.isIOS });
    }

    // Initialize the appropriate storage mechanism
    async initialize() {
        // On non-iOS devices, use IndexedDB for full offline support
        if (!this.isIOS && window.indexedDB) {
            try {
                this.db = await this.openIndexedDB();
                console.log('✅ IndexedDB initialized');
                return true;
            } catch (error) {
                console.error('❌ IndexedDB initialization failed, falling back to localStorage:', error);
                // Fallback to localStorage if IndexedDB fails
                this.isIOS = true; 
                return this.initializeLocalStorage();
            }
        } else {
            // On iOS or if IndexedDB is not supported, use localStorage
            console.log('📱 Using localStorage for metadata');
            return this.initializeLocalStorage();
        }
    }

    // Initialize localStorage (simple check)
    initializeLocalStorage() {
        try {
            const notes = this.getNotesFromLocalStorage();
            console.log(`📱 localStorage initialized with ${notes.length} notes`);
            return true;
        } catch (error) {
            console.error('❌ localStorage initialization error:', error);
            return false;
        }
    }

    // Open and configure IndexedDB
    openIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = (event) => reject(event.target.error);
            request.onsuccess = (event) => resolve(event.target.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.notesStoreName)) {
                    db.createObjectStore(this.notesStoreName, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(this.audioStoreName)) {
                    db.createObjectStore(this.audioStoreName, { keyPath: 'noteId' });
                }
            };
        });
    }

    // Save a note, routing to the correct storage method
    async saveNote(note, audioBlob) {
        // Always save metadata to localStorage as a reliable backup
        this.saveNoteToLocalStorage(note);

        if (this.db) {
            // If IndexedDB is available, save audio blob there for full offline playback
            return this.saveNoteToIndexedDB(note, audioBlob);
        }
        
        // If only localStorage is used, the save is already complete
        return true;
    }

    // Save note metadata to localStorage
    saveNoteToLocalStorage(note) {
        try {
            const notes = this.getNotesFromLocalStorage();
            // Avoid duplicates
            const existingIndex = notes.findIndex(n => n.id === note.id);
            if (existingIndex > -1) {
                notes[existingIndex] = note;
            } else {
                notes.unshift(note);
            }
            
            // Limit to 100 notes to avoid excessive storage usage
            if (notes.length > 100) {
                notes.splice(100);
            }
            
            localStorage.setItem(this.dbName, JSON.stringify(notes));
            console.log('📝 Note metadata saved to localStorage');
            return true;
        } catch (error) {
            console.error('❌ Error saving to localStorage:', error);
            return false;
        }
    }

    // Save full note (metadata + audio) to IndexedDB
    async saveNoteToIndexedDB(note, audioBlob) {
        if (!this.db) return false;
        
        try {
            const transaction = this.db.transaction([this.notesStoreName, this.audioStoreName], 'readwrite');
            const notesStore = transaction.objectStore(this.notesStoreName);
            const audioStore = transaction.objectStore(this.audioStoreName);

            // Add scope and cleaned transcript to the note object for storage
            const scope = window.voiceNotesApp.extractScope(note.transcript);
            const cleanedTranscript = window.voiceNotesApp.cleanNoteContent(note.transcript);

            const noteToStore = { ...note, scope, cleanedTranscript };
            
            await this.promisifyRequest(notesStore.put(noteToStore));
            if (audioBlob) {
                await this.promisifyRequest(audioStore.put({ noteId: note.id, blob: audioBlob }));
            }
            
            console.log('✅ Note and audio saved to IndexedDB');
            return true;
            
        } catch (error) {
            console.error('❌ Error saving to IndexedDB:', error);
            return false;
        }
    }

    // Load all notes from the primary storage
    async loadNotes() {
        if (this.db) {
            return this.loadNotesFromDB();
        } else {
            return this.getNotesFromLocalStorage();
        }
    }

    // Load notes from IndexedDB
    async loadNotesFromDB() {
        if (!this.db) return [];
        try {
            const transaction = this.db.transaction([this.notesStoreName], 'readonly');
            const store = transaction.objectStore(this.notesStoreName);
            const notes = await this.promisifyRequest(store.getAll());
            return notes.sort((a, b) => b.id - a.id);
        } catch (error) {
            console.error('Error loading from IndexedDB:', error);
            return [];
        }
    }

    // Get notes from localStorage
    getNotesFromLocalStorage() {
        try {
            const stored = localStorage.getItem(this.dbName);
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Error reading from localStorage:', error);
            return [];
        }
    }

    // Export all notes aggregated by scope
    async exportAggregatedNotes() {
        const notes = await this.loadNotes();
        
        if (notes.length === 0) {
            window.voiceNotesApp?.showStatus('Nessuna nota da esportare');
            return;
        }
        
        const notesByScope = {};
        notes.forEach(note => {
            // Re-calculate scope on export to ensure consistency
            const scope = window.voiceNotesApp.extractScope(note.transcript);
            if (!notesByScope[scope]) {
                notesByScope[scope] = [];
            }
            notesByScope[scope].push(note);
        });
        
        let content = `# Note Vocali Aggregate\n`;
        content += `Data export: ${new Date().toLocaleString('it-IT')}\n`;
        content += `Totale note: ${notes.length}\n\n`;
        
        Object.keys(notesByScope).sort().forEach(scope => {
            content += `## 📁 AMBITO: ${scope.toUpperCase()}\n\n`;
            notesByScope[scope].forEach((note, idx) => {
                const cleanedContent = window.voiceNotesApp.cleanNoteContent(note.transcript);
                content += `**Nota ${idx + 1}** (${note.timestamp} - ${note.duration}s)\n`;
                content += `> ${cleanedContent || '[Solo audio]'}\n\n`;
                content += `---\n\n`;
            });
        });
        
        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `note_aggregate_${dateStr}.md`;
        
        await this.downloadFile(content, filename, 'text/markdown');
        window.voiceNotesApp?.showStatus('✅ Export completato!');
    }

    // Unified download utility
    async downloadFile(content, filename, type = 'text/plain') {
        const blob = new Blob([content], { type });
        const file = new File([blob], filename, { type });

        // Use Web Share API if available (best for mobile)
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    files: [file],
                    title: 'Voice Notes Export'
                });
                return true;
            } catch (err) {
                // User might have cancelled the share, which is not an error
                if (err.name !== 'AbortError') {
                    console.error('Web Share API failed:', err);
                } else {
                    console.log('Web Share was cancelled by the user.');
                    return false;
                }
            }
        }
        
        // Fallback for desktop browsers or if Web Share fails
        try {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            return true;
        } catch (desktopErr) {
            console.error('Fallback download failed:', desktopErr);
            // Final fallback: show a modal to copy the text
            window.voiceNotesApp?.uiManager.showCopyModal(content);
            return false;
        }
    }

    // Utility to promisify IndexedDB requests
    promisifyRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Get the count of saved notes
    async getNotesCount() {
        const notes = await this.loadNotes();
        return notes.length;
    }
}

// Export globally
window.StorageManager = StorageManager;
