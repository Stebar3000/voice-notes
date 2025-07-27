// storage.js - Manages data persistence and export
// v2.5 - Handles multiple file downloads

class StorageManager {
    constructor() {
        this.db = null;
        this.isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        this.dbName = 'VoiceNotesDB';
        this.dbVersion = 1;
        this.notesStoreName = 'notes';
        this.audioStoreName = 'audioBlobs';
    }

    async initialize() {
        if (!this.isIOS && window.indexedDB) {
            try {
                this.db = await this.openIndexedDB();
            } catch (error) {
                this.isIOS = true; 
                this.initializeLocalStorage();
            }
        } else {
            this.initializeLocalStorage();
        }
    }

    initializeLocalStorage() { console.log(`📱 Using localStorage for metadata`); }

    openIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onerror = e => reject(e.target.error);
            request.onsuccess = e => resolve(e.target.result);
            request.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.notesStoreName)) db.createObjectStore(this.notesStoreName, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(this.audioStoreName)) db.createObjectStore(this.audioStoreName, { keyPath: 'noteId' });
            };
        });
    }

    async saveNote(note, audioBlob) {
        this.saveNoteToLocalStorage(note);
        if (this.db) return this.saveNoteToIndexedDB(note, audioBlob);
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
        } catch (e) { return false; }
    }

    async saveNoteToIndexedDB(note, audioBlob) {
        if (!this.db) return false;
        try {
            const tx = this.db.transaction([this.notesStoreName, this.audioStoreName], 'readwrite');
            await this.promisifyRequest(tx.objectStore(this.notesStoreName).put({ ...note }));
            if (audioBlob) await this.promisifyRequest(tx.objectStore(this.audioStoreName).put({ noteId: note.id, blob: audioBlob }));
            return true;
        } catch (e) { return false; }
    }

    async loadNotes() {
        return this.getNotesFromLocalStorage().sort((a, b) => b.id - a.id);
    }

    getNotesFromLocalStorage() {
        try {
            return JSON.parse(localStorage.getItem(this.dbName)) || [];
        } catch (e) { return []; }
    }

    async downloadFiles(files) {
        const shareableFiles = files.map(f => {
            const blob = new Blob([f.content], { type: f.type });
            return new File([blob], f.filename, { type: f.type });
        });

        if (navigator.share && navigator.canShare && navigator.canShare({ files: shareableFiles })) {
            try {
                await navigator.share({ files: shareableFiles });
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
            }
        }
        
        shareableFiles.forEach((file, index) => {
            setTimeout(() => {
                const url = URL.createObjectURL(file);
                const link = document.createElement('a');
                link.href = url;
                link.download = file.name;
                link.click();
                URL.revokeObjectURL(url);
            }, index * 500);
        });
    }

    async clearAllData() {
        localStorage.removeItem(this.dbName);
        if (this.db) {
            const tx = this.db.transaction([this.notesStoreName, this.audioStoreName], 'readwrite');
            await this.promisifyRequest(tx.objectStore(this.notesStoreName).clear());
            await this.promisifyRequest(tx.objectStore(this.audioStoreName).clear());
        }
    }

    async deleteNote(noteId) {
        const notes = this.getNotesFromLocalStorage().filter(n => n.id !== noteId);
        localStorage.setItem(this.dbName, JSON.stringify(notes));
        if (this.db) {
            const tx = this.db.transaction([this.notesStoreName, this.audioStoreName], 'readwrite');
            await this.promisifyRequest(tx.objectStore(this.notesStoreName).delete(noteId));
            await this.promisifyRequest(tx.objectStore(this.audioStoreName).delete(noteId));
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
