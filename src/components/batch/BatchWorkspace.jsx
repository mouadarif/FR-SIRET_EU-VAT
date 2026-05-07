import BatchEnrichment from './BatchEnrichment';
import './BatchEnrichment.css';
import './BatchWorkspace.css';

export default function BatchWorkspace({ activeService }) {
    const isVatService = activeService === 'vat';

    return (
        <div className="batch-workspace">
            <section
                className="batch-workspace-panel"
                aria-labelledby={isVatService ? 'batch-workspace-title-vat' : 'batch-workspace-title-companies'}
            >
                <div className={`batch-workspace-panel-header ${isVatService ? 'batch-workspace-panel-header-eu' : 'batch-workspace-panel-header-fr'}`}>
                    <p className={`batch-workspace-panel-eyebrow ${isVatService ? 'eyebrow-eu' : 'eyebrow-fr'}`}>
                        {isVatService ? 'TVA' : 'France'}
                    </p>
                    <h3 id={isVatService ? 'batch-workspace-title-vat' : 'batch-workspace-title-companies'}>
                        {isVatService ? 'VAT Verification' : 'Enrichissement INSEE'}
                    </h3>
                </div>

                <BatchEnrichment initialMode={isVatService ? 'vat' : 'siret'} />
            </section>
        </div>
    );
}
