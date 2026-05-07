// Agent 2: Pagination Component
import './results.css';

export default function Pagination({
    currentPage,
    totalResults,
    perPage,
    onPageChange,
    onPerPageChange
}) {
    const totalPages = Math.ceil(totalResults / perPage);
    const startIndex = (currentPage - 1) * perPage + 1;
    const endIndex = Math.min(currentPage * perPage, totalResults);

    const pageSizes = [10, 25, 50, 100];

    return (
        <div className="pagination">
            <div className="pagination-info">
                Affichage de {startIndex} à {endIndex} sur {totalResults} résultats
            </div>

            <div className="page-size-selector">
                Résultats par page :
                {pageSizes.map(size => (
                    <button
                        key={size}
                        className={perPage === size ? 'active' : ''}
                        onClick={() => onPerPageChange(size)}
                    >
                        {size}
                    </button>
                ))}
            </div>

            <div className="page-controls">
                <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage <= 1}
                >
                    ← Précédent
                </button>
                <span className="page-indicator">
                    Page {currentPage} sur {totalPages}
                </span>
                <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                >
                    Suivant →
                </button>
            </div>
        </div>
    );
}
