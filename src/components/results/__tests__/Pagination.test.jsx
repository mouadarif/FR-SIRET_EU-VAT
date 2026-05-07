import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Pagination from '../Pagination.jsx';

describe('Pagination', () => {
    const defaultProps = {
        currentPage: 1,
        totalResults: 73,
        perPage: 25,
        onPageChange: vi.fn(),
        onPerPageChange: vi.fn()
    };

    it('renders the current result window from totalResults', () => {
        render(<Pagination {...defaultProps} />);

        expect(screen.getByText('Affichage de 1 à 25 sur 73 résultats')).toBeInTheDocument();
        expect(screen.getByText('Page 1 sur 3')).toBeInTheDocument();
    });

    it('fires page and page-size actions', () => {
        const onPageChange = vi.fn();
        const onPerPageChange = vi.fn();

        render(
            <Pagination
                {...defaultProps}
                onPageChange={onPageChange}
                onPerPageChange={onPerPageChange}
            />
        );

        fireEvent.click(screen.getByText(/Suivant/));
        fireEvent.click(screen.getByText('50'));

        expect(onPageChange).toHaveBeenCalledWith(2);
        expect(onPerPageChange).toHaveBeenCalledWith(50);
    });
});
