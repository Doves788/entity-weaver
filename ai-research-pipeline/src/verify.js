import fs from 'fs';
import path from 'path';
import axios from 'axios';
import pLimit from 'p-limit';
import 'dotenv/config';

const DATA_DIR = path.join(process.cwd(), 'data');
const RAW_INPUT = path.join(DATA_DIR, 'raw_papers.json');
const VERIFIED_OUTPUT = path.join(DATA_DIR, 'verified_papers.json');

// Using a public proxy or sleep delays to respect GitHub's search rate limit (30 req/min).
// For the demo pipeline, we execute a best-effort search for the repository based on the paper title.

async function searchGithubForPaper(title, limit) {
    return limit(async () => {
        const token = process.env.GITHUB_TOKEN;
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        
        try {
            // Encode the first few words of the title to avoid overly restrictive exact matches
            const queryWords = title.split(' ').slice(0, 5).join(' ');
            const q = encodeURIComponent(`"${queryWords}" in:readme`);

            const res = await axios.get(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=1`, {
                headers,
                // Add a small delay to avoid blowing through secondary rate limits instantly
                timeout: 5000
            });

            const items = res.data.items;
            if (items && items.length > 0) {
                return {
                    github_url: items[0].html_url,
                    github_stars: items[0].stargazers_count
                };
            }
            return { github_url: null, github_stars: null };

        } catch (error) {
            // Handle 403 Rate Limits gracefully
            if (error.response && error.response.status === 403) {
                console.warn(`Rate limit hit while searching for: ${title.substring(0, 30)}...`);
            }
            return { github_url: null, github_stars: null };
        }
    });
}

async function verifyAndCrossReference() {
    console.log('Starting Phase 2: Cross-Referencing Papers with GitHub Metrics...');
    if (!fs.existsSync(RAW_INPUT)) {
        console.error(`Raw data file not found: ${RAW_INPUT}`);
        return;
    }

    const papers = JSON.parse(fs.readFileSync(RAW_INPUT, 'utf-8'));
    
    // Concurrency throttle for GitHub Search API limits
    const limit = pLimit(1); // Keep it sequential to avoid instant 403s on Search API
    
    console.log(`Initiating GitHub telemetry search for ${papers.length} papers. (This process respects rate limits)`);

    const verifiedPapers = [];
    
    for (let i = 0; i < papers.length; i++) {
        const paper = papers[i];
        
        // Sleep for 2.1 seconds between requests to stay exactly under 30 requests/minute
        await new Promise(r => setTimeout(r, 2100));
        
        const githubData = await searchGithubForPaper(paper.content.title, limit);
        
        verifiedPapers.push({
            schemaVersion: paper.schemaVersion,
            recordType: paper.recordType,
            content: {
                title: paper.content.title,
                authors: paper.content.authors,
                paper_url: paper.content.paper_url,
                github_url: githubData.github_url || 'N/A',
                github_stars: githubData.github_stars || 0,
                published_date: paper.content.published_date
            }
        });
        
        if (i > 0 && i % 50 === 0) {
            console.log(`Processed ${i} / ${papers.length} papers...`);
            // Checkpoint save
            fs.writeFileSync(VERIFIED_OUTPUT, JSON.stringify(verifiedPapers, null, 2));
        }
    }

    console.log(`Finished cross-referencing.`);
    fs.writeFileSync(VERIFIED_OUTPUT, JSON.stringify(verifiedPapers, null, 2));
    console.log(`Saved enriched data to ${VERIFIED_OUTPUT}`);
}

verifyAndCrossReference();

