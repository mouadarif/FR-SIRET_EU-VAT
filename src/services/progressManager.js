/**
 * Progress Manager Service
 * Handles robust progress saving with checkpoints and resume capability
 */

import { saveState, loadState, clearState } from './storageService';

const CHECKPOINT_INTERVAL = 5; // Save every 5 processed rows
const AUTO_SAVE_INTERVAL = 10000; // Auto-save every 10 seconds

/**
 * Progress state structure
 */
export class ProgressState {
    constructor(rows = [], fileName = '') {
        this.rows = rows;
        this.fileName = fileName;
        this.results = [];
        this.stats = {
            total: rows.length,
            processed: 0,
            tier2: 0,
            tier3: 0,
            tier4: 0,
            tier5: 0,
            found: 0,
            notFound: 0
        };
        this.startTime = Date.now();
        this.lastSaveTime = Date.now();
        this.paused = false;
        this.completed = false;
        this.sessionId = `enrichment_${Date.now()}`;
    }

    /**
     * Update progress with new result
     */
    addResult(result, tierStats) {
        this.results.push(result);
        this.stats.processed++;
        
        // Update tier stats
        if (tierStats) {
            Object.keys(tierStats).forEach(key => {
                if (this.stats.hasOwnProperty(key)) {
                    this.stats[key] = tierStats[key];
                }
            });
        }
    }

    /**
     * Mark as completed
     */
    complete() {
        this.completed = true;
        this.paused = false;
    }

    /**
     * Pause processing
     */
    pause() {
        this.paused = true;
    }

    /**
     * Resume processing
     */
    resume() {
        this.paused = false;
    }

    /**
     * Get unprocessed rows (for resume)
     */
    getUnprocessedRows() {
        return this.rows.slice(this.stats.processed);
    }

    /**
     * Get progress percentage
     */
    getProgressPercent() {
        return this.stats.total > 0 ? (this.stats.processed / this.stats.total) * 100 : 0;
    }

    /**
     * Get elapsed time in milliseconds
     */
    getElapsedTime() {
        return Date.now() - this.startTime;
    }

    /**
     * Estimate remaining time in milliseconds
     */
    getEstimatedTimeRemaining() {
        if (this.stats.processed === 0) return null;
        
        const avgTimePerRow = this.getElapsedTime() / this.stats.processed;
        const remaining = this.stats.total - this.stats.processed;
        return avgTimePerRow * remaining;
    }

    /**
     * Serialize to JSON for storage
     */
    toJSON() {
        return {
            rows: this.rows,
            fileName: this.fileName,
            results: this.results,
            stats: this.stats,
            startTime: this.startTime,
            lastSaveTime: this.lastSaveTime,
            paused: this.paused,
            completed: this.completed,
            sessionId: this.sessionId
        };
    }

    /**
     * Deserialize from JSON
     */
    static fromJSON(data) {
        const state = new ProgressState(data.rows, data.fileName);
        state.results = data.results || [];
        state.stats = data.stats || state.stats;
        state.startTime = data.startTime || Date.now();
        state.lastSaveTime = data.lastSaveTime || Date.now();
        state.paused = data.paused || false;
        state.completed = data.completed || false;
        state.sessionId = data.sessionId || state.sessionId;
        return state;
    }
}

/**
 * Progress Manager
 * Handles automatic checkpoint saving
 */
export class ProgressManager {
    constructor() {
        this.progressState = null;
        this.autoSaveTimer = null;
        this.checkpointCounter = 0;
    }

    /**
     * Initialize new progress
     */
    async initialize(rows, fileName) {
        this.progressState = new ProgressState(rows, fileName);
        await this.save();
        this.startAutoSave();
        console.log(`📊 Progress initialized: ${rows.length} rows`);
        return this.progressState;
    }

    /**
     * Load existing progress
     */
    async load() {
        const savedData = await loadState();
        if (savedData) {
            this.progressState = ProgressState.fromJSON(savedData);
            console.log(`📂 Progress loaded: ${this.progressState.stats.processed}/${this.progressState.stats.total} completed`);
            
            if (!this.progressState.completed) {
                this.startAutoSave();
            }
            
            return this.progressState;
        }
        return null;
    }

    /**
     * Update progress with new result
     */
    async update(result, tierStats) {
        if (!this.progressState) {
            console.error('❌ Progress state not initialized');
            return;
        }

        this.progressState.addResult(result, tierStats);
        this.checkpointCounter++;

        // Save checkpoint every N rows
        if (this.checkpointCounter >= CHECKPOINT_INTERVAL) {
            await this.save();
            this.checkpointCounter = 0;
            console.log(`💾 Checkpoint: ${this.progressState.stats.processed}/${this.progressState.stats.total}`);
        }
    }

    /**
     * Save progress to storage
     */
    async save() {
        if (!this.progressState) return;
        
        this.progressState.lastSaveTime = Date.now();
        await saveState(this.progressState.toJSON());
    }

    /**
     * Mark as completed and save final state
     */
    async complete() {
        if (!this.progressState) return;
        
        this.progressState.complete();
        this.stopAutoSave();
        await this.save();
        console.log(`✅ Progress completed: ${this.progressState.stats.found} found, ${this.progressState.stats.notFound} not found`);
    }

    /**
     * Pause processing
     */
    async pause() {
        if (!this.progressState) return;
        
        this.progressState.pause();
        await this.save();
        console.log('⏸️ Progress paused');
    }

    /**
     * Resume processing
     */
    resume() {
        if (!this.progressState) return;
        
        this.progressState.resume();
        console.log('▶️ Progress resumed');
    }

    /**
     * Clear all progress
     */
    async clear() {
        this.stopAutoSave();
        this.progressState = null;
        this.checkpointCounter = 0;
        await clearState();
        console.log('🗑️ Progress cleared');
    }

    /**
     * Start auto-save timer
     */
    startAutoSave() {
        this.stopAutoSave(); // Clear any existing timer
        
        this.autoSaveTimer = setInterval(async () => {
            if (this.progressState && !this.progressState.completed) {
                await this.save();
                console.log(`💾 Auto-save: ${this.progressState.stats.processed}/${this.progressState.stats.total}`);
            }
        }, AUTO_SAVE_INTERVAL);
    }

    /**
     * Stop auto-save timer
     */
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }

    /**
     * Get current progress state
     */
    getState() {
        return this.progressState;
    }

    /**
     * Check if can resume
     */
    canResume() {
        return this.progressState && 
               !this.progressState.completed && 
               this.progressState.stats.processed < this.progressState.stats.total;
    }
}

