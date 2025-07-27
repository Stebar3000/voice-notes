// storage.js - Manages data persistence and export
// v2.9 - TEXT-ONLY FINAL VERSION. Ultra-reliable, uses localStorage only.

class StorageManager {
    constructor() {
        this.dbName = 'VoiceNotesDB_TextOnly'; // New name to avoid conflicts
        console.log("✅ StorageManager initialized (Text-Only Mode).");
    }

    // No initialization needed for localStorage, but we keep the async structure.
    async initialize() {
        return Promise.resolve(true);
    }

    // The saveNote function now only cares about the note object.
    async saveNote(note) {
        try {
            const notes = this.getNotesFromLocalStorage();
            const existingIndex = notes.findIndex(n => n.id === note.id);
            if (existingIndex > -1) {
                notes[existingIndex] = note;
            } else {
                notes.unshift(note);
            }
            localStorage.setItem(this.dbName, JSON.stringify(notes));
            return true;
        } catch (e) {
            console.error("🚨 CRITICAL: Failed to save note to localStorage:", e);
            return false;
        }
    }

    async loadNotes() {
        return this.getNotesFromLocalStorage().sort((a, b) => b.id - a.id);
    }

    getNotesFromLocalStorage() {
        try {
            return JSON.parse(localStorage.getItem(this.dbName)) || [];
        } catch (e) {
            // If parsing fails, return an empty array to prevent app crash.
            return [];
        }
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
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }, index * 500);
        });
    }

    async clearAllData() {
        localStorage.removeItem(this.dbName);
    }

    async deleteNote(noteId) {
        const notes = this.getNotesFromLocalStorage().filter(n => n.id !== noteId);
        localStorage.setItem(this.dbName, JSON.stringify(notes));
    }
}

window.StorageManager = StorageManager;
