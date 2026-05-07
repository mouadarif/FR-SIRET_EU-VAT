import {
    DEFAULT_VISIBLE_COLUMN_KEYS,
    getColumnDisplayValue
} from './columnConfig';
import './results.css';

function escapeCsvCell(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

export default function ExportButton({
    results,
    filename,
    availableColumns = [],
    visibleColumnKeys = DEFAULT_VISIBLE_COLUMN_KEYS
}) {
    const selectedColumns = availableColumns.filter((column) => visibleColumnKeys.includes(column.key));

    const exportToCSV = () => {
        const headers = selectedColumns.map((column) => escapeCsvCell(column.label)).join(',');
        const rows = results.map((row) => selectedColumns
            .map((column) => escapeCsvCell(getColumnDisplayValue(row, column.key)))
            .join(','));

        const csvContent = [headers, ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const csvName = (filename || 'companies').replace(/\.[^/.]+$/, '') + '.csv';
        downloadBlob(blob, csvName);
    };

    const exportToExcel = () => {
        const headerCells = selectedColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
        const bodyRows = results
            .map((row) => {
                const cells = selectedColumns
                    .map((column) => `<td>${escapeHtml(getColumnDisplayValue(row, column.key))}</td>`)
                    .join('');
                return `<tr>${cells}</tr>`;
            })
            .join('');

        const htmlTable = `
<html>
<head>
<meta charset="UTF-8" />
</head>
<body>
<table border="1">
<thead><tr>${headerCells}</tr></thead>
<tbody>${bodyRows}</tbody>
</table>
</body>
</html>`;

        const blob = new Blob([htmlTable], { type: 'application/vnd.ms-excel;charset=utf-8;' });
        const excelName = (filename || 'companies').replace(/\.[^/.]+$/, '') + '.xls';
        downloadBlob(blob, excelName);
    };

    return (
        <div className="export-button-group">
            <button className="export-button" onClick={exportToCSV} type="button">
                Exporter CSV
            </button>
            <button className="export-button export-button-secondary" onClick={exportToExcel} type="button">
                Exporter Excel
            </button>
        </div>
    );
}
