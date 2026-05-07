import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressManager, ProgressState } from '../progressManager.js';
import { loadState, saveState } from '../storageService.js';

vi.mock('../storageService.js', () => ({
    saveState: vi.fn(async () => undefined),
    loadState: vi.fn(async () => null),
    clearState: vi.fn(async () => undefined)
}));

describe('progress checkpoint/resume', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('restores saved checkpoint and resumes remaining rows', async () => {
        const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
        const saved = new ProgressState(rows, 'companies.csv');
        saved.stats.processed = 1;
        saved.results = [{ id: 1, API_Status: 'SUCCESS' }];

        loadState.mockResolvedValue(saved.toJSON());

        const manager = new ProgressManager();
        const state = await manager.load();

        expect(state.stats.processed).toBe(1);
        expect(state.getUnprocessedRows()).toHaveLength(2);
        expect(manager.canResume()).toBe(true);
        manager.stopAutoSave();
    });

    it('writes checkpoints during updates', async () => {
        const rows = [{ id: 1 }];
        const manager = new ProgressManager();
        await manager.initialize(rows, 'companies.csv');
        await manager.update({ id: 1, API_Status: 'SUCCESS' }, { notFound: 0, found: 1 });

        expect(saveState).toHaveBeenCalled();
        manager.stopAutoSave();
    });
});
