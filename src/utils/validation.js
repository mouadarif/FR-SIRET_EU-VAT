// Agent 1: Input validation utilities
export const validateId = (id) => {
    const cleanId = id.replace(/[\s-]/g, '');

    if (cleanId.length === 14 && /^\d{14}$/.test(cleanId)) {
        return { valid: true, type: 'siret', formatted: cleanId };
    } else if (cleanId.length === 9 && /^\d{9}$/.test(cleanId)) {
        return { valid: true, type: 'siren', formatted: cleanId };
    }
    return { valid: false, type: null, formatted: null };
};

export const validateName = (name) => {
    const trimmed = name.trim();
    if (trimmed.length < 3) {
        return {
            valid: false,
            message: `Saisissez au moins 3 caractères (encore ${3 - trimmed.length})`
        };
    }
    return { valid: true, message: `Valide (${trimmed.length} caractères)` };
};

export const validatePostalCode = (postalCode) => {
    if (!postalCode) return { valid: true, message: '' };

    if (/^\d{5}$/.test(postalCode)) {
        return { valid: true, message: 'Code postal valide' };
    }
    return { valid: false, message: 'Le code postal doit contenir 5 chiffres' };
};
