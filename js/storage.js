// storage.js - Manages data persistence and export
// v2.1-beta - Added clear and delete methods

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

    async initialize() {
        if (!this.isIOS && window.indexedDB) {
            try {
                this.db = await this.openIndexedDB();
                console.log('✅ IndexedDB initialized');
                return true;
            } catch (error) {
                console.error('❌ IndexedDB failed, falling back to localStorage:', error);
                this.isIOS = true; 
                return this.initializeLocalStorage();
            }
        } else {
            return this.initializeLocalStorage();
        }
    }

    initializeLocalStorage() {
        console.log(`📱 Using localStorage for metadata`);
        return true;
    }

    openIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onerror = e => reject(e.target.error);
            request.onsuccess = e => resolve(e.target.result);
            request.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.notesStoreName)) {
                    db.createObjectStore(this.notesStoreName, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(this.audioStoreName)) {
                    db.createObjectStore(this.audioStoreName, { keyPath: 'noteId' });
                }
            };
        });
    }

    async saveNote(note, audioBlob) {
        this.saveNoteToLocalStorage(note);
        if (this.db) {
            return this.saveNoteToIndexedDB(note, audioBlob);
        }
        return true;
    }

    saveNoteToLocalStorage(note) {
        try {
            const notes = this.getNotesFromLocalStorage();
            const existingIndex = notes.findIndex(n => n.id === note.id);
            if (existingIndex > -1) notes[existingIndex] = note;
            else notes.unshift(note);
            
            if (notes.length > 100) notes.splice(100);
            
            localStorage.setItem(this.dbName, JSON.stringify(notes));
            return true;
        } catch (error) {
            console.error('❌ Error saving to localStorage:', error);
            return false;
        }
    }

    async saveNoteToIndexedDB(note, audioBlob) {
        if (!this.db) return false;
        try {
            const tx = this.db.transaction([this.notesStoreName, this.audioStoreName], 'readwrite');
            const noteToStore = { ...note };
            await this.promisifyRequest(tx.objectStore(this.notesStoreName).put(noteToStore));
            if (audioBlob) {
                await this.promisifyRequest(tx.objectStore(this.audioStoreName).put({ noteId: note.id, blob: audioBlob }));
            }
            return true;
        } catch (error) {
            console.error('❌ Error saving to IndexedDB:', error);
            return false;
        }
    }

    async loadNotes() {
        // Always load from localStorage as the single source of truth for metadata
        return this.getNotesFromLocalStorage().sort((a, b) => b.id - a.id);
    }

    getNotesFromLocalStorage() {
        try {
            const stored = localStorage.getItem(this.dbName);
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            return [];
        }
    }

    async exportAggregatedNotes(notes) {
        if (!notes || notes.length === 0) {
            throw new Error("No notes to export.");
        }
        
        const notesByScope = {};
        notes.forEach(note => {
            const scope = window.voiceNotesApp.extractScope(note.transcript);
            if (!notesByScope[scope]) notesByScope[scope] = [];
            notesByScope[scope].push(note);
        });
        
        let content = `# Note Vocali Aggregate\n`;
        content += `Data export: ${new Date().toLocaleString('it-IT')}\n\n`;
        
        Object.keys(notesByScope).sort().forEach(scope => {
            content += `## 📁 AMBITO: ${scope.toUpperCase()}\n\n`;
            notesByScope[scope].forEach(note => {
                const cleanedContent = window.voiceNotesApp.cleanNoteContent(note.transcript);
                content += `**${note.timestamp}** (${note.duration}s)\n`;
                content += `> ${cleanedContent || '[Solo audio]'}\n\n---\n\n`;
            });
        });
        
        const filename = `note_aggregate_${new Date().toISOString().slice(0, 10)}.md`;
        await this.downloadFile(content, filename, 'text/markdown');
    }

    async downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const file = new File([blob], filename, { type });

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: 'Voice Notes Export' });
                return;
            } catch (err) {
                if (err.name === 'AbortError') {
                    console.log('Share cancelled by user.');
                    return; // Not an error
                }
                // Fall through to download if share fails for other reasons
            }
        }
        
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    async clearAllData() {
        localStorage.removeItem(this.dbName);
        if (this.db) {
            try {
                const tx = this.db.transaction([this.notesStoreName, this.audioStoreName], 'readwrite');
                await this.promisifyRequest(tx.objectStore(this.notesStoreName).clear());
                await this.promisifyRequest(tx.objectStore(this.audioStoreName).clear());
                console.log('✅ IndexedDB cleared');
            } catch (error) {
                console.error("Failed to clear IndexedDB:", error);
            }
        }
        console.log('✅ All data cleared');
    }

    async deleteNote(noteId) {
        const notes = this.getNotesFromLocalStorage();
        const filteredNotes = notes.filter(n => n.id !== noteId);
        localStorage.setItem(this.dbName, JSON.stringify(filteredNotes));

        if (this.db) {
            try {
                const tx = this.db.transaction([this.notesStoreName, this.audioStoreName], 'readwrite');
                await this.promisifyRequest(tx.objectStore(this.notesStoreName).delete(noteId));
                await this.promisifyRequest(tx.objectStore(this.audioStoreName).delete(noteId));
                console.log(`✅ Note ${noteId} deleted from IndexedDB`);
            } catch (error) {
                console.error(`Failed to delete note ${noteId} from IndexedDB:`, error);
            }
        }
    }

    promisifyRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

window.StorageManager = StorageManager;
