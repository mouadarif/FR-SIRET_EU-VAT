import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AdvancedFilterPanel from '../AdvancedFilterPanel.jsx';

describe('AdvancedFilterPanel', () => {
    it('shows advanced filters expanded on first use', () => {
        render(<AdvancedFilterPanel filters={{}} onChange={vi.fn()} isVisible={true} />);

        expect(screen.getByLabelText(/Filtrer par SIRET/i)).toBeInTheDocument();
    });

    it('normalizes the SIRET filter to digits', () => {
        const onChange = vi.fn();
        render(<AdvancedFilterPanel filters={{}} onChange={onChange} isVisible={true} />);

        fireEvent.change(screen.getByLabelText(/Filtrer par SIRET/i), {
            target: { value: '123 ABC 456' }
        });

        expect(onChange).toHaveBeenCalledWith({ siret: '123456' });
    });
});
