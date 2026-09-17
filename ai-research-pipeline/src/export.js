import fs from 'fs';
import path from 'path';
import { parse } from 'json2csv';

const DATA_DIR = path.join(process.cwd(), 'data');
const VERIFIED_INPUT = path.join(DATA_DIR, 'verified_papers.json');
const CSV_OUTPUT = path.join(DATA_DIR, 'final_research_papers.csv');

// Helper to prevent CSV Formula Injection
function sanitizeCSV(field) {
    if (typeof field === 'string' && /^[=+\-@]/.test(field)) {
        return "'" + field;
    }
    return field;
}

function exportData() {
    console.log('Starting Phase 3: Exporting Research Papers Data...');
    if (!fs.existsSync(VERIFIED_INPUT)) {
        console.error(`Verified data file not found: ${VERIFIED_INPUT}`);
        return;
    }

    const verifiedPapers = JSON.parse(fs.readFileSync(VERIFIED_INPUT, 'utf-8'));

    const csvData = verifiedPapers.map(paper => {
        // Flatten authors array to a string
        const authorString = Array.isArray(paper.content.authors) 
                             ? paper.content.authors.join(', ') 
                             : paper.content.authors;

        return {
            'Schema Version': paper.schemaVersion,
            'Record Type': paper.recordType,
            'Paper Title': sanitizeCSV(paper.content.title),
            'Authors': sanitizeCSV(authorString),
            'Paper URL': paper.content.paper_url,
            'Associated GitHub URL': paper.content.github_url,
            'GitHub Stars': paper.content.github_stars,
            'Published Date': paper.content.published_date
        };
    });

    try {
        const csv = parse(csvData);
        fs.writeFileSync(CSV_OUTPUT, csv);
        console.log(`Successfully exported ${csvData.length} records to ${CSV_OUTPUT}`);
        console.log('\nReady for Phase 1 Deliverables (Research Papers with GitHub Metrics):');
        console.log('Import final_research_papers.csv into Google Sheets.');
    } catch (err) {
        console.error('Error generating CSV:', err.message);
    }
}

exportData();

