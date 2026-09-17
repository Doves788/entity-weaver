import fs from 'fs';
import path from 'path';
import { parse } from 'json2csv';

const DATA_DIR = path.join(process.cwd(), 'data');
const RAW_INPUT = path.join(DATA_DIR, 'raw_startups.json');
const CSV_OUTPUT = path.join(DATA_DIR, 'final_startups.csv');

// Helper to prevent CSV Formula Injection
function sanitizeCSV(field) {
    if (typeof field === 'string' && /^[=+\-@]/.test(field)) {
        return "'" + field;
    }
    return field;
}

function exportData() {
    console.log('Starting Export for Startups Dataset...');
    if (!fs.existsSync(RAW_INPUT)) {
        console.error(`Data file not found: ${RAW_INPUT}`);
        return;
    }

    const startups = JSON.parse(fs.readFileSync(RAW_INPUT, 'utf-8'));

    const csvData = startups.map(startup => ({
        'Schema Version': startup.schemaVersion,
        'Record Type': startup.recordType,
        'Source Name': sanitizeCSV(startup.source.name),
        'Source URL': startup.source.url,
        'Canonical Startup Name': sanitizeCSV(startup.content.entityName),
        'Estimated Employee Count': startup.content.data.employeeCount || 'Unknown',
        'Primary Business Sector': sanitizeCSV(startup.content.data.inferredSector),
        'Algorithmic Employee Count': startup.content.data.algorithmicEmployeeCount,
        'Open Source Downloads (Traction)': startup.content.data.openSourceTraction,
        'Collected At': startup.collectedAt
    }));

    try {
        const csv = parse(csvData);
        fs.writeFileSync(CSV_OUTPUT, csv);
        console.log(`Successfully exported ${csvData.length} startup records to ${CSV_OUTPUT}`);
        console.log('\nReady for Phase 1 Deliverables (Startups):');
        console.log('Import final_startups.csv into the "Startups" tab of your Google Sheet.');
    } catch (err) {
        console.error('Error generating CSV:', err.message);
    }
}

exportData();

