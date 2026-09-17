import fs from 'fs';
import path from 'path';
import { parse } from 'json2csv';

const DATA_DIR = path.join(process.cwd(), 'data');
const SCORED_INPUT = path.join(DATA_DIR, 'scored_models.json');
const CSV_OUTPUT = path.join(DATA_DIR, 'final_models.csv');

// Helper to prevent CSV Formula Injection
function sanitizeCSV(field) {
    if (typeof field === 'string' && /^[=+\-@]/.test(field)) {
        return "'" + field;
    }
    return field;
}

// Phase 6: Final Deliverables & Submission Workflow
function exportData() {
    console.log('Starting Phase 6: Exporting Data...');
    if (!fs.existsSync(SCORED_INPUT)) {
        console.error(`Scored data file not found: ${SCORED_INPUT}`);
        return;
    }

    const scoredModels = JSON.parse(fs.readFileSync(SCORED_INPUT, 'utf-8'));

    const csvData = scoredModels.map(model => ({
        'Model Name': sanitizeCSV(model.canonical_name),
        'Model Family': sanitizeCSV(model.canonical_name.split(' ')[0] || 'Unknown'),
        'Company / Provider': sanitizeCSV(model.provider_company),
        'Official Website': model.official_website,
        'Official Logo URL': model.official_logo_url || 'N/A',
        'Category / Task': sanitizeCSV(model.pipeline_tag || 'Multimodal / Text Generation'),
        'Context Window': model.context_window || 'N/A',
        'Open Weights Status': model.open_weights_status,
        'LLM Description': sanitizeCSV(model.llm_description),
        'Quality Score': model.quality_score,
        'Last Verified Date': model.last_verified_date
    }));

    try {
        const csv = parse(csvData);
        fs.writeFileSync(CSV_OUTPUT, csv);
        console.log(`Successfully exported ${csvData.length} records to ${CSV_OUTPUT}`);
        console.log('\nReady for Phase 6 Deliverables:');
        console.log('1. Import final_models.csv into Google Sheets and share with "Anyone with the link can view".');
        console.log('2. Push this repository to GitHub.');
        console.log('3. Submit both links as per the trial instructions.');
    } catch (err) {
        console.error('Error generating CSV:', err.message);
    }
}

exportData();
