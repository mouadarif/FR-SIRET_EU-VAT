import { describe, expect, it } from 'vitest';
import { verifyExtractionRow } from '../llmVerifier.js';

describe('llm verifier', () => {
    it('accepts valid row-local evidence and normalizes identifiers/date', () => {
        const inputRow = {
            row_id: 'R000001',
            parse_status: 'parsed',
            fields: {
                company_name_raw: { value: 'STE DUPONT SARL', evidence_text: 'STE DUPONT SARL', confidence: 0.94 },
                company_name_core: { value: 'DUPONT', evidence_text: 'STE DUPONT SARL', confidence: 0.9 },
                city: { value: 'Paris', evidence_text: 'PARIS', confidence: 0.98 },
                postal_code: { value: '75008', evidence_text: '75008', confidence: 0.99 },
                siren: { value: null, evidence_text: null, confidence: 0 },
                siret: { value: null, evidence_text: null, confidence: 0 },
                legal_form: { value: 'SARL', evidence_text: 'SARL', confidence: 0.95 },
                transaction_date: { value: '2024-03-12', evidence_text: '2024-03-12', confidence: 0.96 },
                address_fragment: { value: '12 RUE DES LILAS', evidence_text: '12 RUE DES LILAS', confidence: 0.9 }
            },
            invalid_field_count: 0,
            notes: []
        };

        const { row, verification } = verifyExtractionRow(
            inputRow,
            'STE DUPONT SARL 12 RUE DES LILAS 75008 PARIS FACTURE 2024-03-12'
        );

        expect(row.parse_status).toBe('parsed');
        expect(row.fields.city.value).toBe('PARIS');
        expect(row.fields.postal_code.value).toBe('75008');
        expect(row.fields.transaction_date.value).toBe('2024-03-12');
        expect(verification.invalid_field_count).toBe(0);
        expect(verification.evidence_valid).toBe(true);
    });

    it('flags contamination and nulls invalid extracted fields', () => {
        const inputRow = {
            row_id: 'R000002',
            parse_status: 'parsed',
            fields: {
                company_name_raw: { value: 'DUPNTO SA', evidence_text: 'DUPNTO SA', confidence: 0.7 },
                company_name_core: { value: 'DUPNTO', evidence_text: 'DUPNTO SA', confidence: 0.65 },
                city: { value: 'MARSEILLE', evidence_text: 'PARIS', confidence: 0.9 },
                postal_code: { value: '1300?', evidence_text: '1300?', confidence: 0.7 },
                siren: { value: null, evidence_text: null, confidence: 0 },
                siret: { value: null, evidence_text: null, confidence: 0 },
                legal_form: { value: 'SA', evidence_text: 'SA', confidence: 0.8 },
                transaction_date: { value: null, evidence_text: null, confidence: 0 },
                address_fragment: { value: null, evidence_text: null, confidence: 0 }
            },
            invalid_field_count: 0,
            notes: []
        };

        const { row, verification } = verifyExtractionRow(
            inputRow,
            'DUPNTO SA MARSEILE 1300? ACOMPTE FOURNISSEUR'
        );

        expect(row.parse_status).toBe('low_confidence');
        expect(row.fields.city.value).toBeNull();
        expect(row.fields.postal_code.value).toBeNull();
        expect(verification.invalid_field_count).toBeGreaterThan(0);
        expect(verification.evidence_valid).toBe(false);
    });
});
