/**
 * Parallel KPI engine.
 */

function getByPath(object, path) {
    if (!object || !path) return undefined;
    const parts = String(path).split('.');
    let current = object;
    for (const part of parts) {
        if (current == null) return undefined;
        if (/^\d+$/.test(part)) {
            current = current[Number.parseInt(part, 10)];
        } else {
            current = current[part];
        }
    }
    return current;
}

/**
 * @param {{
 *  catalog: any[],
 *  entity: any,
 *  metadata?: any,
 *  fetchAggregate?: any
 * }} params
 */
export async function runKpiEngine(params) {
    const catalog = params.catalog || [];
    const entity = params.entity || {};
    const metadata = params.metadata || {};
    const fetchAggregate = params.fetchAggregate;

    const values = {};
    const perKpiMeta = {};

    await Promise.all(catalog.map(async (kpi) => {
        try {
            let value = '';
            if (kpi.type === 'field') {
                value = getByPath(entity, kpi.path) ?? '';
            } else if (kpi.type === 'derived' && typeof kpi.compute === 'function') {
                value = await kpi.compute({ entity, metadata });
            } else if (kpi.type === 'aggregate' && typeof kpi.compute === 'function') {
                value = await kpi.compute({
                    entity,
                    metadata,
                    fetchAggregate
                });
            }
            values[kpi.column] = value ?? '';
            perKpiMeta[kpi.id] = { status: 'ok' };
        } catch (error) {
            values[kpi.column] = '';
            perKpiMeta[kpi.id] = { status: 'error', message: error?.message || String(error) };
        }
    }));

    return {
        values,
        perKpiMeta
    };
}

