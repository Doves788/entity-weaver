import fs from 'fs';
import path from 'path';
import axios from 'axios';
import pLimit from 'p-limit';
import 'dotenv/config';

const DATA_DIR = path.join(process.cwd(), 'data');
const CLEANED_INPUT = path.join(DATA_DIR, 'cleaned_models.json');
const VERIFIED_OUTPUT = path.join(DATA_DIR, 'verified_models.json');
const DLQ_OUTPUT = path.join(DATA_DIR, 'quarantine_dlq.jsonl');

function getDomainForProvider(provider) {
    const domainMap = {
        'openai': 'openai.com',
        'anthropic': 'anthropic.com',
        'google': 'google.com',
        'meta': 'meta.com',
        'mistralai': 'mistral.ai',
        'cohere': 'cohere.com'
    };
    const key = provider.toLowerCase().replace(/[^a-z]/g, '');
    return domainMap[key] || `${key}.com`;
}

// 1. Precise Modeling: GitHub GraphQL API Fetcher
async function fetchGithubMetrics(repoOwner, repoName) {
    const token = process.env.GITHUB_TOKEN; // Optional: If missing, returns fallback
    if (!token) return null;

    const query = `
    query {
      repository(owner: "${repoOwner}", name: "${repoName}") {
        stargazerCount
        pushedAt
        issues(states: OPEN) {
          totalCount
        }
        licenseInfo {
          spdxId
        }
      }
    }`;

    try {
        const res = await axios.post('https://api.github.com/graphql', 
            { query }, 
            { headers: { Authorization: `Bearer ${token}` } }
        );
        const repo = res.data?.data?.repository;
        if (!repo) return null;
        
        return {
            stars: repo.stargazerCount,
            open_issues: repo.issues.totalCount,
            last_commit: repo.pushedAt,
            license: repo.licenseInfo?.spdxId || 'Unknown'
        };
    } catch (e) {
        return null;
    }
}

// Phase 4: Official Verification, Logo Extraction & Ecosystem Enrichment
async function verifyData() {
    console.log('Starting Phase 4: Verification, Logo Check, & GitHub GraphQL Enrichment...');
    if (!fs.existsSync(CLEANED_INPUT)) {
        console.error(`Cleaned data file not found: ${CLEANED_INPUT}`);
        return;
    }

    const cleanedModels = JSON.parse(fs.readFileSync(CLEANED_INPUT, 'utf-8'));
    const limit = pLimit(20); 

    const verificationPromises = cleanedModels.map(model => limit(async () => {
        const domain = getDomainForProvider(model.provider_company);
        const logoUrl = `https://icon.horse/icon/${domain}`;
        let logoValid = false;

        try {
            const response = await axios.head(logoUrl, { timeout: 2000 });
            if (response.status === 200 && response.headers['content-type'].startsWith('image/')) {
                logoValid = true;
            }
        } catch (error) {
            // Ignore for speed
        }

        // Open-Source vs Open-Weight heuristic
        let openWeightsStatus = 'Closed Source / API Only';
        if (model.providers.includes('HuggingFace') || model.providers.includes('GitHub')) {
            if (model.provider_company.toLowerCase().includes('meta') || model.canonical_name.toLowerCase().includes('llama')) {
                openWeightsStatus = 'Open-Weight (Restrictive Commercial)';
            } else {
                openWeightsStatus = 'Open-Source (Permissive)';
            }
        }

        // Precise Ecosystem Modeling: Resolve GitHub metadata if applicable
        let githubMetrics = null;
        if (model.providers.includes('GitHub')) {
            // Repo structure is typically stored in canonical_name or provider during extraction
            // We do a best-effort lookup based on the clean name
            githubMetrics = await fetchGithubMetrics(model.provider_company, model.canonical_name);
        }

        return {
            ...model,
            official_website: `https://www.${domain}`,
            official_logo_url: logoValid ? logoUrl : null,
            open_weights_status: openWeightsStatus,
            github_metrics: githubMetrics,
            last_verified_date: new Date().toISOString().split('T')[0]
        };
    }));

    const verifiedModels = await Promise.all(verificationPromises);

    console.log(`Verified & Enriched ${verifiedModels.length} models.`);
    fs.writeFileSync(VERIFIED_OUTPUT, JSON.stringify(verifiedModels, null, 2));
    console.log(`Saved verified data to ${VERIFIED_OUTPUT}`);
}

verifyData();
