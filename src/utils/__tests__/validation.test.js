// Agent 1: Validation utilities tests
import { describe, it, expect } from 'vitest';
import { validateId, validateName, validatePostalCode } from '../validation';

describe('validateId', () => {
    it('should validate 14-digit SIRET correctly', () => {
        const result = validateId('13001045700013');
        expect(result.valid).toBe(true);
        expect(result.type).toBe('siret');
        expect(result.formatted).toBe('13001045700013');
    });

    it('should validate 9-digit SIREN correctly', () => {
        const result = validateId('130025265');
        expect(result.valid).toBe(true);
        expect(result.type).toBe('siren');
        expect(result.formatted).toBe('130025265');
    });

    it('should strip spaces and dashes', () => {
        const result = validateId('130 010 457 00013');
        expect(result.valid).toBe(true);
        expect(result.formatted).toBe('13001045700013');
    });

    it('should reject invalid length', () => {
        const result = validateId('12345');
        expect(result.valid).toBe(false);
        expect(result.type).toBe(null);
    });

    it('should reject non-numeric input', () => {
        const result = validateId('ABCDEFGHIJ');
        expect(result.valid).toBe(false);
    });
});

describe('validateName', () => {
    it('should accept name with 3+ characters', () => {
        const result = validateName('Pizza');
        expect(result.valid).toBe(true);
        expect(result.message).toContain('Valide');
    });

    it('should reject name with less than 3 characters', () => {
        const result = validateName('Pi');
        expect(result.valid).toBe(false);
        expect(result.message).toContain('encore 1');
    });

    it('should trim whitespace', () => {
        const result = validateName('  Ab  ');
        expect(result.valid).toBe(false);
    });

    it('should show character count', () => {
        const result = validateName('Restaurant');
        expect(result.message).toContain('10 caractères');
    });
});

describe('validatePostalCode', () => {
    it('should accept valid 5-digit postal code', () => {
        const result = validatePostalCode('75001');
        expect(result.valid).toBe(true);
    });

    it('should accept empty postal code (optional)', () => {
        const result = validatePostalCode('');
        expect(result.valid).toBe(true);
    });

    it('should reject invalid postal code', () => {
        const result = validatePostalCode('123');
        expect(result.valid).toBe(false);
    });

    it('should reject non-numeric postal code', () => {
        const result = validatePostalCode('ABCDE');
        expect(result.valid).toBe(false);
    });
});
