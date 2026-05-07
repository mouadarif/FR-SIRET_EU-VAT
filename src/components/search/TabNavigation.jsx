import './search.css';

export default function TabNavigation({ activeService, activeTab, onTabChange }) {
    const tabs = activeService === 'vat' ? [
        { id: 'id', label: 'Valider un numéro TVA', icon: 'ID' },
        { id: 'batch', label: 'Validation en masse', icon: '⇄' }
    ] : [
        { id: 'name', label: 'Rechercher par nom', icon: 'FR' },
        { id: 'id', label: 'Rechercher par identifiant', icon: 'ID' },
        { id: 'batch', label: 'Enrichissement en masse', icon: '⇄' }
    ];

    return (
        <nav className={`tab-navigation domain-${activeService}`} aria-label="Modes de recherche" role="tablist">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => onTabChange(tab.id)}
                >
                    <span aria-hidden="true">{tab.icon}</span>
                    <span>{tab.label}</span>
                </button>
            ))}
        </nav>
    );
}
