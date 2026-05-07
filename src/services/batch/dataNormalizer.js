/**
 * Data Normalizer
 * Transforms raw INSEE API establishment data into flat row objects,
 * and ensures columns are in the correct display order.
 */

/**
 * Normalize a single establishment object from the INSEE API response
 * into a flat key/value object with consistent API_* prefixed keys.
 */
export function normalizeEstablishment(etab) {
    const periode = etab.periodesEtablissement?.[0] || {};
    const uniteLegale = etab.uniteLegale || {};
    const adresse = etab.adresseEtablissement || {};

    return {
        API_SIRET: etab.siret || '',
        API_SIREN: etab.siren || '',
        API_Nom: periode.denominationUsuelleEtablissement ||
            periode.enseigne1Etablissement ||
            uniteLegale.denominationUniteLegale ||
            'N/A',
        API_Raison_Sociale: uniteLegale.denominationUniteLegale || '',
        API_Etat: periode.etatAdministratifEtablissement || '',
        API_Adresse_Numero: adresse.numeroVoieEtablissement || '',
        API_Adresse_Voie: adresse.libelleVoieEtablissement || '',
        API_Code_Postal: adresse.codePostalEtablissement || '',
        API_Commune: adresse.libelleCommuneEtablissement || '',
        API_Activite: periode.activitePrincipaleEtablissement || '',
        API_Siege: etab.etablissementSiege ? 'Oui' : 'Non'
    };
}

/**
 * Reorganize row columns to proper order:
 * 1. ERP_ID (if exists)
 * 2. All Original_* columns
 * 3. All Enriched_* columns
 * 4. All API_* columns
 * 5. Any other columns
 */
export function reorganizeColumns(rowData) {
    const organized = {};
    const originalCols = {};
    const enrichedCols = {};
    const apiCols = {};
    const otherCols = {};

    // Separate columns by prefix
    for (const [key, value] of Object.entries(rowData)) {
        if (key === 'ERP_ID') {
            organized.ERP_ID = value;
        } else if (key.startsWith('Original_')) {
            originalCols[key] = value;
        } else if (key.startsWith('Enriched_')) {
            enrichedCols[key] = value;
        } else if (key.startsWith('API_')) {
            apiCols[key] = value;
        } else {
            otherCols[key] = value;
        }
    }

    return {
        ...organized,
        ...originalCols,
        ...enrichedCols,
        ...apiCols,
        ...otherCols
    };
}
