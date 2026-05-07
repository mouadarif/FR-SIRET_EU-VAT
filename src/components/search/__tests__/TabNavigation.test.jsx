import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabNavigation from '../TabNavigation';

describe('TabNavigation', () => {
    it('should render all tabs', () => {
        const mockOnTabChange = vi.fn();
        render(<TabNavigation activeService="insee" activeTab="name" onTabChange={mockOnTabChange} />);

        expect(screen.getByText(/Rechercher par nom/i)).toBeInTheDocument();
        expect(screen.getByText(/Rechercher par identifiant/i)).toBeInTheDocument();
        expect(screen.getByText(/Enrichissement en masse/i)).toBeInTheDocument();
    });

    it('should highlight active tab', () => {
        const mockOnTabChange = vi.fn();
        const { container } = render(
            <TabNavigation activeService="insee" activeTab="name" onTabChange={mockOnTabChange} />
        );

        const buttons = container.querySelectorAll('.tab-button');
        expect(buttons[0]).toHaveClass('active');
        expect(buttons[1]).not.toHaveClass('active');
        expect(screen.getByRole('tablist', { name: /Modes de recherche/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Rechercher par nom/i })).toHaveAttribute('aria-selected', 'true');
    });

    it('should call onTabChange when clicking a tab', () => {
        const mockOnTabChange = vi.fn();
        render(<TabNavigation activeService="insee" activeTab="name" onTabChange={mockOnTabChange} />);

        fireEvent.click(screen.getByText(/Rechercher par identifiant/i));

        expect(mockOnTabChange).toHaveBeenCalledWith('id');
    });

    it('should switch active tab', () => {
        const mockOnTabChange = vi.fn();
        const { container, rerender } = render(
            <TabNavigation activeService="insee" activeTab="name" onTabChange={mockOnTabChange} />
        );

        rerender(<TabNavigation activeService="insee" activeTab="id" onTabChange={mockOnTabChange} />);

        const buttons = container.querySelectorAll('.tab-button');
        expect(buttons[0]).not.toHaveClass('active');
        expect(buttons[1]).toHaveClass('active');
    });
});
