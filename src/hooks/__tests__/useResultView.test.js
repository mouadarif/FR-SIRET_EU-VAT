import { describe, expect, it } from 'vitest';
import { DEFAULT_VISIBLE_COLUMN_KEYS } from '../../components/results/columnConfig';
import {
    applyResultFilters,
    reconcileVisibleColumnKeys
} from '../useResultView';

describe('applyResultFilters', () => {
    const results = [
        {
            siret: '111',
            nom_complet: 'Alpha Fruits',
            siege: {
                adresse: '10 Rue des Tests',
                code_postal: '75001',
                libelle_commune: 'Paris'
            },
            etat_administratif: 'A'
        },
        {
            siret: '222',
            nom_raison_sociale: 'Beta Logistics',
            geo_adresse: '20 Avenue Example',
            code_postal: '13001',
            libelle_commune: 'Marseille',
            etat_administratif: 'C'
        }
    ];

    it('matches against normalized company fields', () => {
        const filtered = applyResultFilters(results, {
            nom_complet: 'alpha',
            adresse: 'tests',
            code_postal: '750',
            libelle_commune: 'par',
            etat_administratif: 'a',
            siret: '111'
        });

        expect(filtered).toEqual([results[0]]);
    });

    it('returns all results when filters are empty', () => {
        const filtered = applyResultFilters(results, {
            nom_complet: '',
            adresse: '',
            code_postal: '',
            libelle_commune: '',
            etat_administratif: '',
            siret: ''
        });

        expect(filtered).toEqual(results);
    });
});

describe('reconcileVisibleColumnKeys', () => {
    it('preserves visible columns that still exist', () => {
        const availableColumns = [
            { key: 'nom_complet' },
            { key: 'siret' },
            { key: 'libelle_commune' }
        ];

        expect(
            reconcileVisibleColumnKeys(availableColumns, ['siret', 'unknown'])
        ).toEqual(['siret']);
    });

    it('falls back to the default visible columns when none are preserved', () => {
        const availableColumns = DEFAULT_VISIBLE_COLUMN_KEYS
            .slice(0, 3)
            .map((key) => ({ key }));

        expect(
            reconcileVisibleColumnKeys(availableColumns, ['missing'])
        ).toEqual(DEFAULT_VISIBLE_COLUMN_KEYS.slice(0, 3));
    });
});
