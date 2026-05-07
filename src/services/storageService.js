/**
 * Storage Service with localStorage fallback to IndexedDB
 * Handles large datasets gracefully by detecting quota errors
 */

import { get, set, del } from 'idb-keyval';

const STORAGE_KEY = 'batch_enrichment_state';
const MAX_LOCALSTORAGE_SIZE = 4.5 * 1024 * 1024; // 4.5MB (safe margin under 5MB limit)

/**
 * Estimate JSON size in bytes
 */
function estimateSize(obj) {
    return new Blob([JSON.stringify(obj)]).size;
}

/**
 * Save state with automatic fallback to IndexedDB
 */
export async function saveState(state) {
    const size = estimateSize(state);

    // Try localStorage first (faster)
    if (size < MAX_LOCALSTORAGE_SIZE) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            console.log(`💾 Saved to localStorage (${(size / 1024).toFixed(1)}KB)`);
            return;
        } catch (e) {
            console.warn('⚠️ localStorage failed, falling back to IndexedDB:', e.message);
        }
    }

    // Fallback to IndexedDB for large datasets
    try {
        await set(STORAGE_KEY, state);
        console.log(`💾 Saved to IndexedDB (${(size / 1024).toFixed(1)}KB)`);
    } catch (e) {
        console.error('❌ Storage failed completely:', e);
        throw new Error('Impossible de sauvegarder la progression. Le jeu de données est peut-être trop volumineux.');
    }
}

/**
 * Load state from localStorage or IndexedDB
 */
export async function loadState() {
    // Try localStorage first
    try {
        const localData = localStorage.getItem(STORAGE_KEY);
        if (localData) {
            console.log('📂 Loaded from localStorage');
            return JSON.parse(localData);
        }
    } catch (e) {
        console.warn('⚠️ localStorage read failed:', e.message);
    }

    // Try IndexedDB
    try {
        const idbData = await get(STORAGE_KEY);
        if (idbData) {
            console.log('📂 Loaded from IndexedDB');
            return idbData;
        }
    } catch (e) {
        console.warn('⚠️ IndexedDB read failed:', e.message);
    }

    return null;
}

/**
 * Clear state from both storage mechanisms
 */
export async function clearState() {
    try {
        localStorage.removeItem(STORAGE_KEY);
        await del(STORAGE_KEY);
        console.log('🗑️ State cleared');
    } catch (e) {
        console.warn('⚠️ Clear state warning:', e.message);
    }
}
