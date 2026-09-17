import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';

const DATA_DIR = path.join(process.cwd(), 'data');
const RAW_OUTPUT = path.join(DATA_DIR, 'raw_papers.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function fetchArxivPapers() {
    console.log('Fetching Phase 1: Research Papers from Arxiv API...');
    try {
        // Querying for CS.AI, CS.LG (Machine Learning), CS.CV (Computer Vision)
        // Fetching top 1000 most recent papers
        const response = await axios.get('http://export.arxiv.org/api/query', {
            params: {
                search_query: 'cat:cs.AI OR cat:cs.LG OR cat:cs.CV',
                sortBy: 'submittedDate',
                sortOrder: 'descending',
                start: 0,
                max_results: 1000
            }
        });

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix : "@_"
        });
        const jsonObj = parser.parse(response.data);
        const entries = jsonObj.feed.entry || [];

        const papers = entries.map(entry => {
            // Handle multiple authors
            let authors = [];
            if (Array.isArray(entry.author)) {
                authors = entry.author.map(a => a.name);
            } else if (entry.author) {
                authors = [entry.author.name];
            }

            return {
                schemaVersion: "1.0",
                recordType: "RESEARCH_PAPER",
                content: {
                    title: entry.title.replace(/\n/g, ' ').trim(),
                    authors: authors,
                    paper_url: entry.id,
                    published_date: entry.published,
                    summary: entry.summary.replace(/\n/g, ' ').trim() // Kept for GitHub searching
                }
            };
        });

        console.log(`Successfully extracted ${papers.length} research papers.`);
        fs.writeFileSync(RAW_OUTPUT, JSON.stringify(papers, null, 2));
        console.log(`Saved raw papers to ${RAW_OUTPUT}`);
    } catch (error) {
        console.error('Error fetching Arxiv papers:', error.message);
    }
}

fetchArxivPapers();

