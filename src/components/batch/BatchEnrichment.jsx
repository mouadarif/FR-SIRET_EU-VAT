import { useEffect, useReducer, useRef } from 'react';
import { saveAs } from 'file-saver';
import {
    SUPPORTED_SPREADSHEET_EXTENSIONS,
    detectCountryColumn,
    detectSiretColumn,
    detectVatColumn,
    parseSpreadsheetFile,
    submitSiretEnrichment,
    submitViesEnrichment
} from '../../services/batchEnrichmentService';
import { clearState, loadState, saveState } from '../../services/storageService';
import './BatchEnrichment.css';

const SUPPORTED_FILE_PATTERN = /\.(csv|tsv|xlsx|xlsm)$/i;

const initialState = {
    file: null,
    rows: [],
    mode: 'siret',
    siretColumn: '',
    vatColumn: '',
    countryColumn: '',
    processing: false,
    progress: null,
    resultFile: null,
    error: null
};

function reducer(state, action) {
    switch (action.type) {
        case 'LOAD_SAVED_STATE':
            return {
                ...state,
                rows: action.payload.rows || [],
                progress: action.payload.progress || null,
                mode: action.payload.mode || state.mode,
                siretColumn: action.payload.siretColumn || action.payload.columnMapping?.siret || '',
                vatColumn: action.payload.vatColumn || '',
                countryColumn: action.payload.countryColumn || '',
                file: action.payload.fileName ? { name: action.payload.fileName, _isMock: true } : null
            };
        case 'RESET_JOB':
            return { ...initialState, mode: state.mode, file: action.payload?.file || null };
        case 'SET_FILE_DATA':
            return {
                ...state,
                file: action.payload.file,
                rows: action.payload.rows,
                siretColumn: action.payload.siretColumn,
                vatColumn: action.payload.vatColumn,
                countryColumn: action.payload.countryColumn,
                resultFile: null,
                progress: null,
                error: null
            };
        case 'SET_MODE':
            return { ...state, mode: action.payload, resultFile: null, progress: null, error: null };
        case 'SET_SIRET_COLUMN':
            return { ...state, siretColumn: action.payload };
        case 'SET_VAT_COLUMN':
            return { ...state, vatColumn: action.payload };
        case 'SET_COUNTRY_COLUMN':
            return { ...state, countryColumn: action.payload };
        case 'SET_PROCESSING':
            return { ...state, processing: action.payload };
        case 'SET_PROGRESS':
            return { ...state, progress: action.payload };
        case 'SET_RESULT_FILE':
            return { ...state, resultFile: action.payload };
        case 'SET_ERROR':
            return { ...state, error: action.payload, processing: false };
        default:
            return state;
    }
}

function isSupportedFile(file) {
    return Boolean(file?.name && SUPPORTED_FILE_PATTERN.test(file.name));
}

function columnsFromRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return Object.keys(rows[0]).filter((key) => key !== '_row_id');
}

function formatNumber(value) {
    return String(value || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function buildProgress(total, overrides = {}) {
    return {
        total,
        processed: overrides.processed || 0,
        currentRow: overrides.currentRow || 'Waiting'
    };
}

function getModeLabel(mode) {
    return mode === 'vat' ? 'Validation TVA' : 'SIRET INSEE';
}

function normalizeInitialMode(initialMode) {
    return initialMode === 'vat' ? 'vat' : 'siret';
}

export default function BatchEnrichment({ initialMode = 'siret' }) {
    const [state, dispatch] = useReducer(reducer, {
        ...initialState,
        mode: normalizeInitialMode(initialMode)
    });
    const {
        file,
        rows,
        mode,
        siretColumn,
        vatColumn,
        countryColumn,
        processing,
        progress,
        resultFile,
        error
    } = state;
    const saveTimeoutRef = useRef(null);
    const columns = columnsFromRows(rows);
    const isVatMode = mode === 'vat';
    const modeLabel = getModeLabel(mode);
    const selectedRequiredColumn = isVatMode ? vatColumn : siretColumn;
    const selectedColumnLabel = selectedRequiredColumn || 'Aucune colonne selectionnee';

    useEffect(() => {
        dispatch({ type: 'SET_MODE', payload: normalizeInitialMode(initialMode) });
    }, [initialMode]);

    useEffect(() => {
        loadState()
            .then((savedState) => {
                if (savedState) {
                    dispatch({ type: 'LOAD_SAVED_STATE', payload: savedState });
                    dispatch({ type: 'SET_MODE', payload: normalizeInitialMode(initialMode) });
                }
            })
            .catch((loadError) => {
                console.error('Failed to load saved state', loadError);
            });
    }, [initialMode]);

    const debouncedSave = (stateToSave) => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            saveState(stateToSave).catch((saveError) => {
                dispatch({ type: 'SET_ERROR', payload: `Failed to save progress: ${saveError.message}` });
            });
        }, 500);
    };

    const loadInputFile = async (selectedFile) => {
        if (!selectedFile) return;

        if (!(selectedFile instanceof File)) {
            dispatch({ type: 'SET_ERROR', payload: 'Invalid file object.' });
            return;
        }

        if (!isSupportedFile(selectedFile)) {
            dispatch({ type: 'SET_ERROR', payload: 'Import a CSV, TSV, XLSX, or XLSM file.' });
            return;
        }

        await clearState();
        dispatch({ type: 'RESET_JOB', payload: { file: selectedFile } });

        try {
            const parsedRows = await parseSpreadsheetFile(selectedFile);
            const parsedColumns = columnsFromRows(parsedRows);
            const detectedSiretColumn = detectSiretColumn(parsedColumns) || '';
            const detectedVatColumn = detectVatColumn(parsedColumns) || '';
            const detectedCountryColumn = detectCountryColumn(parsedColumns) || '';

            dispatch({
                type: 'SET_FILE_DATA',
                payload: {
                    file: selectedFile,
                    rows: parsedRows,
                    siretColumn: detectedSiretColumn,
                    vatColumn: detectedVatColumn,
                    countryColumn: detectedCountryColumn
                }
            });

            debouncedSave({
                rows: parsedRows,
                progress: null,
                mode,
                siretColumn: detectedSiretColumn,
                vatColumn: detectedVatColumn,
                countryColumn: detectedCountryColumn,
                fileName: selectedFile.name
            });
        } catch (parseError) {
            dispatch({ type: 'SET_ERROR', payload: `File parsing failed: ${parseError.message}` });
        }
    };

    const handleFileSelect = async (event) => {
        await loadInputFile(event.target.files?.[0]);
    };

    const handleDrop = async (event) => {
        event.preventDefault();
        await loadInputFile(event.dataTransfer.files[0]);
    };

    const startEnrichment = async () => {
        if (!file || file._isMock) {
            dispatch({ type: 'SET_ERROR', payload: 'Selectionnez a nouveau le fichier source avant de lancer le backend.' });
            return;
        }

        if (!selectedRequiredColumn) {
            dispatch({
                type: 'SET_ERROR',
                payload: isVatMode ? 'Selectionnez la colonne TVA avant de lancer l enrichissement.' : 'Selectionnez la colonne SIRET avant de lancer l enrichissement.'
            });
            return;
        }

        dispatch({ type: 'SET_ERROR', payload: null });
        dispatch({ type: 'SET_PROCESSING', payload: true });
        dispatch({ type: 'SET_RESULT_FILE', payload: null });
        dispatch({
            type: 'SET_PROGRESS',
            payload: buildProgress(rows.length, { currentRow: 'Enrichissement en cours... cela peut prendre quelques secondes par ligne.' })
        });

        try {
            const output = isVatMode
                ? await submitViesEnrichment({ file, vatColumn, countryColumn })
                : await submitSiretEnrichment({ file, siretColumn });

            const finalProgress = buildProgress(output.rowCount || rows.length, {
                processed: output.rowCount || rows.length,
                currentRow: 'Fichier enrichi genere par le backend.'
            });

            dispatch({ type: 'SET_RESULT_FILE', payload: output });
            dispatch({ type: 'SET_PROGRESS', payload: finalProgress });

            await saveState({
                rows,
                progress: finalProgress,
                mode,
                siretColumn,
                vatColumn,
                countryColumn,
                fileName: file.name
            });
        } catch (enrichmentError) {
            dispatch({ type: 'SET_ERROR', payload: `Echec de l enrichissement backend : ${enrichmentError.message}` });
        } finally {
            dispatch({ type: 'SET_PROCESSING', payload: false });
        }
    };

    const downloadResult = () => {
        if (!resultFile?.blob) return;
        saveAs(resultFile.blob, resultFile.filename || (isVatMode ? 'enriched_by_vat.xlsx' : 'enriched_by_siret.xlsx'));
    };

    const resetJob = async () => {
        await clearState();
        dispatch({ type: 'RESET_JOB', payload: null });
    };

    const switchMode = (nextMode) => {
        dispatch({ type: 'SET_MODE', payload: nextMode });
        debouncedSave({
            rows,
            progress: null,
            mode: nextMode,
            siretColumn,
            vatColumn,
            countryColumn,
            fileName: file?.name
        });
    };

    const statusTotal = progress?.total || rows.length;
    const processed = progress?.processed || 0;

    return (
        <div className="batch-enrichment">
            <div className="batch-header">
                <h1>Import en lot</h1>
                <p>Importez un CSV ou Excel, choisissez le traitement sur le cote, puis lancez le backend Python securise.</p>
            </div>

            <div className="batch-enrichment-body">
                <aside className="batch-mode-sidebar" aria-label="Choix du traitement">
                    <p className="batch-mode-eyebrow">Traitement</p>
                    <button
                        type="button"
                        className={`batch-mode-choice ${!isVatMode ? 'active' : ''}`}
                        onClick={() => switchMode('siret')}
                        aria-pressed={!isVatMode}
                    >
                        <span className="batch-mode-choice-icon">FR</span>
                        <span>
                            <strong>SIRET INSEE</strong>
                            <small>Enrichir par SIRET</small>
                        </span>
                    </button>
                    <button
                        type="button"
                        className={`batch-mode-choice ${isVatMode ? 'active' : ''}`}
                        onClick={() => switchMode('vat')}
                        aria-pressed={isVatMode}
                    >
                        <span className="batch-mode-choice-icon">TVA</span>
                        <span>
                            <strong>TVA / VAT Verification</strong>
                            <small>Verifier legal name, VAT et adresse</small>
                        </span>
                    </button>
                </aside>

                <div className="batch-enrichment-main">
                    <div
                        className="upload-zone"
                        onDrop={handleDrop}
                        onDragOver={(event) => event.preventDefault()}
                    >
                        <div className="upload-content">
                            <div className="upload-icon">{isVatMode ? 'TVA' : 'SIRET'}</div>
                            <p>Deposez un fichier CSV, TSV ou Excel ici</p>
                            <input
                                type="file"
                                accept={SUPPORTED_SPREADSHEET_EXTENSIONS}
                                onChange={handleFileSelect}
                                style={{ display: 'none' }}
                                id="file-input"
                            />
                            <label htmlFor="file-input" className="btn btn-secondary">
                                Choisir un fichier
                            </label>
                            <p className="upload-hint">CSV, TSV, XLSX ou XLSM</p>
                            {file && (
                                <div className="file-info">
                                    <p>{file.name}</p>
                                    <p>{formatNumber(rows.length)} lignes chargees</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="error-message">
                            Erreur : {error}
                        </div>
                    )}

                    {rows.length > 0 && !processing && !resultFile && (
                        <div className="column-mapping-step">
                            <h3>{isVatMode ? 'Colonnes TVA' : 'Colonne SIRET'}</h3>
                            <p>Le fichier est envoye au backend Python. Les appels externes restent cote serveur.</p>

                            <div className="preflight-summary" aria-live="polite">
                                <div>
                                    <strong>{formatNumber(rows.length)}</strong>
                                    <span>lignes</span>
                                </div>
                                <div>
                                    <strong>{modeLabel}</strong>
                                    <span>traitement</span>
                                </div>
                                <div>
                                    <strong>{selectedColumnLabel}</strong>
                                    <span>{isVatMode ? 'colonne TVA' : 'colonne SIRET'}</span>
                                </div>
                                {isVatMode && (
                                    <div>
                                        <strong>{countryColumn || 'Prefixe TVA'}</strong>
                                        <span>pays</span>
                                    </div>
                                )}
                            </div>

                            <table className="mapping-table">
                                <thead>
                                    <tr>
                                        <th>Champ</th>
                                        <th>Colonne du fichier</th>
                                        <th>Valeur exemple</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {!isVatMode && (
                                        <tr>
                                            <td className="field-label">SIRET</td>
                                            <td>
                                                <select
                                                    className="mapping-select"
                                                    aria-label="Colonne contenant le SIRET"
                                                    value={siretColumn}
                                                    onChange={(event) => dispatch({ type: 'SET_SIRET_COLUMN', payload: event.target.value })}
                                                >
                                                    <option value="">Choisir une colonne</option>
                                                    {columns.map((column) => (
                                                        <option key={column} value={column}>{column}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td>
                                                <span className="sample-value" title={siretColumn ? String(rows[0]?.[siretColumn] || '') : ''}>
                                                    {siretColumn ? String(rows[0]?.[siretColumn] || '-') : '-'}
                                                </span>
                                            </td>
                                        </tr>
                                    )}
                                    {isVatMode && (
                                        <>
                                            <tr>
                                                <td className="field-label">TVA / VAT</td>
                                                <td>
                                                    <select
                                                        className="mapping-select"
                                                        aria-label="Colonne contenant la TVA"
                                                        value={vatColumn}
                                                        onChange={(event) => dispatch({ type: 'SET_VAT_COLUMN', payload: event.target.value })}
                                                    >
                                                        <option value="">Choisir une colonne</option>
                                                        {columns.map((column) => (
                                                            <option key={column} value={column}>{column}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td>
                                                    <span className="sample-value" title={vatColumn ? String(rows[0]?.[vatColumn] || '') : ''}>
                                                        {vatColumn ? String(rows[0]?.[vatColumn] || '-') : '-'}
                                                    </span>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td className="field-label">Pays TVA optionnel</td>
                                                <td>
                                                    <select
                                                        className="mapping-select"
                                                        aria-label="Colonne contenant le code pays TVA"
                                                        value={countryColumn}
                                                        onChange={(event) => dispatch({ type: 'SET_COUNTRY_COLUMN', payload: event.target.value })}
                                                    >
                                                        <option value="">Deduit du prefixe VAT</option>
                                                        {columns.map((column) => (
                                                            <option key={column} value={column}>{column}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td>
                                                    <span className="sample-value" title={countryColumn ? String(rows[0]?.[countryColumn] || '') : ''}>
                                                        {countryColumn ? String(rows[0]?.[countryColumn] || '-') : '-'}
                                                    </span>
                                                </td>
                                            </tr>
                                        </>
                                    )}
                                </tbody>
                            </table>

                            <div className="mapping-actions">
                                <button
                                    className="btn btn-primary btn-large"
                                    onClick={startEnrichment}
                                >
                                    Lancer l'enrichissement
                                </button>
                            </div>
                        </div>
                    )}

                    {(processing || resultFile) && progress && (
                        <div className="enrichment-progress">
                            <div className="progress-header">
                                <h3>Progression</h3>
                                <div className="status-indicator">
                                    <span className={`status-dot ${processing ? 'pulsing' : 'complete'}`} />
                                    <span className="status-text">{processing ? 'Traitement backend...' : 'Termine'}</span>
                                </div>
                            </div>

                            <div className="progress-stats-grid">
                                <div className="stat-card primary">
                                    <div className="stat-label">Lignes</div>
                                    <div className="stat-value-large">{formatNumber(processed)} / {formatNumber(statusTotal)}</div>
                                    <div className="stat-percentage">{statusTotal > 0 ? Math.round((processed / statusTotal) * 100) : 0}%</div>
                                </div>
                                <div className="stat-card success">
                                    <div className="stat-label">Backend</div>
                                    <div className="stat-value-large">{processing ? 'RUN' : 'OK'}</div>
                                    <div className="stat-subtext">{modeLabel}</div>
                                </div>
                                <div className="stat-card info">
                                    <div className="stat-label">Boundary</div>
                                    <div className="stat-value-large">API</div>
                                    <div className="stat-subtext">Cote serveur</div>
                                </div>
                            </div>

                            <div className="progress-bar-container">
                                <div className="progress-bar">
                                    <div
                                        className="progress-fill"
                                        style={{ width: `${statusTotal > 0 ? (processed / statusTotal) * 100 : 0}%` }}
                                    />
                                </div>
                                <div className="progress-text">
                                    {progress.currentRow}
                                </div>
                            </div>
                        </div>
                    )}

                    {resultFile && (
                        <div className="export-controls">
                            <h3>Enrichissement termine</h3>
                            <div className="result-summary-card">
                                <strong>{formatNumber(resultFile.rowCount || rows.length)} lignes traitees</strong>
                                <span>Le backend a genere le classeur enrichi. Consultez le fichier pour le detail des statuts.</span>
                            </div>

                            <button className="btn btn-primary btn-large" onClick={downloadResult}>
                                Telecharger les resultats (Excel)
                            </button>
                            <button className="btn btn-secondary" onClick={resetJob}>
                                Traiter un autre fichier
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
