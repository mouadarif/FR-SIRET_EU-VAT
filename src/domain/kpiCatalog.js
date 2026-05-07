/**
 * KPI catalog.
 * Each KPI declares type + dependencies so request fields can be optimized.
 */

/**
 * @typedef {{
 *  id: string,
 *  column: string,
 *  type: 'field' | 'derived' | 'aggregate',
 *  dependencies?: string[],
 *  path?: string,
 *  compute?: (ctx: any) => any | Promise<any>
 * }} KpiDefinition
 */

/**
 * @type {KpiDefinition[]}
 */
const DEFAULT_KPI_CATALOG = [
    { id: 'kpi_siret', column: 'KPI_SIRET', type: 'field', path: 'siret', dependencies: ['siret'] },
    { id: 'kpi_siren', column: 'KPI_SIREN', type: 'field', path: 'siren', dependencies: ['siren'] },
    {
        id: 'kpi_company_name',
        column: 'KPI_COMPANY_NAME',
        type: 'derived',
        dependencies: [
            'uniteLegale.denominationUniteLegale',
            'periodesEtablissement.denominationUsuelleEtablissement',
            'periodesEtablissement.enseigne1Etablissement'
        ],
        compute: ({ entity }) => {
            const period = entity?.periodesEtablissement?.[0] || {};
            const legal = entity?.uniteLegale || {};
            return period.denominationUsuelleEtablissement
                || period.enseigne1Etablissement
                || legal.denominationUniteLegale
                || '';
        }
    },
    {
        id: 'kpi_admin_status',
        column: 'KPI_ADMIN_STATUS',
        type: 'field',
        path: 'periodesEtablissement.0.etatAdministratifEtablissement',
        dependencies: ['periodesEtablissement.etatAdministratifEtablissement']
    },
    {
        id: 'kpi_is_headquarters',
        column: 'KPI_IS_HEADQUARTERS',
        type: 'derived',
        dependencies: ['etablissementSiege'],
        compute: ({ entity }) => (entity?.etablissementSiege ? 'YES' : 'NO')
    },
    {
        id: 'kpi_creation_date',
        column: 'KPI_CREATION_DATE',
        type: 'field',
        path: 'dateCreationEtablissement',
        dependencies: ['dateCreationEtablissement']
    },
    {
        id: 'kpi_naf',
        column: 'KPI_NAF',
        type: 'field',
        path: 'periodesEtablissement.0.activitePrincipaleEtablissement',
        dependencies: ['periodesEtablissement.activitePrincipaleEtablissement']
    },
    {
        id: 'kpi_postal_code',
        column: 'KPI_POSTAL_CODE',
        type: 'field',
        path: 'adresseEtablissement.codePostalEtablissement',
        dependencies: ['adresseEtablissement.codePostalEtablissement']
    },
    {
        id: 'kpi_city',
        column: 'KPI_CITY',
        type: 'field',
        path: 'adresseEtablissement.libelleCommuneEtablissement',
        dependencies: ['adresseEtablissement.libelleCommuneEtablissement']
    },
    {
        id: 'kpi_establishment_count',
        column: 'KPI_ESTABLISHMENT_COUNT',
        type: 'aggregate',
        dependencies: ['siren'],
        compute: async ({ entity, fetchAggregate }) => {
            const siren = entity?.siren;
            if (!siren) return '';
            return fetchAggregate(`establishment_count:${siren}`, async () => {
                const response = await fetchAggregate.searchBySiren(siren);
                return response?.header?.total ?? response?.etablissements?.length ?? '';
            });
        }
    }
];

/**
 * Optional presets extension point.
 * @param {'default'} preset
 */
export function getKpiCatalog(preset = 'default') {
    if (preset === 'default') return DEFAULT_KPI_CATALOG;
    return DEFAULT_KPI_CATALOG;
}

/**
 * Build "champs" dependency list from active KPI catalog + identity fields.
 * @param {KpiDefinition[]} catalog
 */
export function collectRequiredFields(catalog) {
    const identityFields = [
        'siret',
        'siren',
        'etablissementSiege',
        'dateCreationEtablissement',
        'uniteLegale.denominationUniteLegale',
        'periodesEtablissement.denominationUsuelleEtablissement',
        'periodesEtablissement.enseigne1Etablissement',
        'periodesEtablissement.etatAdministratifEtablissement',
        'periodesEtablissement.activitePrincipaleEtablissement',
        'adresseEtablissement.codePostalEtablissement',
        'adresseEtablissement.libelleCommuneEtablissement'
    ];

    const kpiFields = (catalog || []).flatMap((kpi) => kpi.dependencies || []);
    return [...new Set([...identityFields, ...kpiFields])];
}
