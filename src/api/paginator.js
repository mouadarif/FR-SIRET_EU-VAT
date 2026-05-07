/**
 * Guardrails for INSEE JSON pagination.
 */

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
}

/**
 * Enforce incompatible parameters: tri + curseur must never be sent together.
 * @param {{tri?: string | null, curseur?: string | null}} params
 */
export function assertTriCurseurGuard(params = {}) {
    if (params.tri && params.curseur) {
        throw new Error('INSEE guardrail: `tri` cannot be used with `curseur`.');
    }
}

/**
 * Clamp JSON pagination limits enforced by INSEE.
 * @param {{nombre?: number, debut?: number}} params
 */
export function clampJsonPagination(params = {}) {
    return {
        nombre: clampInt(params.nombre, 1, 1000, 25),
        debut: clampInt(params.debut, 0, 1000, 0)
    };
}

/**
 * Build cursor pagination params. Starts at curseur="*".
 * @param {{nombre?: number, tri?: string | null}} params
 */
export function buildCursorStartParams(params = {}) {
    assertTriCurseurGuard({ tri: params.tri, curseur: '*' });
    const { nombre } = clampJsonPagination(params);
    return {
        nombre,
        curseur: '*'
    };
}

/**
 * Cursor pagination loop for deep JSON pagination.
 * Stops when curseur does not advance (header.curseur === header.curseurSuivant).
 *
 * @template T
 * @param {(cursor: string) => Promise<T>} fetchPage
 * @param {{startCursor?: string, maxPages?: number}} [options]
 * @returns {Promise<T[]>}
 */
export async function paginateByCursor(fetchPage, options = {}) {
    const pages = [];
    const maxPages = clampInt(options.maxPages, 1, 5000, 500);
    let cursor = options.startCursor || '*';
    let loops = 0;

    while (cursor && loops < maxPages) {
        const payload = await fetchPage(cursor);
        pages.push(payload);
        loops += 1;

        const header = payload?.header || {};
        const currentCursor = header.curseur;
        const nextCursor = header.curseurSuivant;

        if (!nextCursor || currentCursor === nextCursor) {
            break;
        }

        cursor = nextCursor;
    }

    return pages;
}

