import fs from 'fs';
import path from 'path';
import axios from 'axios';

const DATA_DIR = path.join(process.cwd(), 'data');
const RAW_OUTPUT = path.join(DATA_DIR, 'raw_startups.json');

// ============================================================================
// ALGORITHM 1: Jaro-Winkler Distance (Entity Canonicalization)
// Solves Phase IV: Merging dirty variations like "OpenAI", "OpenAI Inc", "open-ai"
// ============================================================================
function jaroWinklerDistance(s1, s2) {
    if (s1 === s2) return 1.0;
    const len1 = s1.length, len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0.0;
    
    const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);
    
    let matches = 0, transpositions = 0;
    for (let i = 0; i < len1; i++) {
        const start = Math.max(0, i - matchDistance);
        const end = Math.min(i + matchDistance + 1, len2);
        for (let j = start; j < end; j++) {
            if (s2Matches[j]) continue;
            if (s1[i] !== s2[j]) continue;
            s1Matches[i] = true;
            s2Matches[j] = true;
            matches++;
            break;
        }
    }
    if (matches === 0) return 0.0;
    
    let k = 0;
    for (let i = 0; i < len1; i++) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }
    
    const m = matches;
    const jaro = (m / len1 + m / len2 + (m - Math.floor(transpositions / 2)) / m) / 3.0;
    
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
        if (s1[i] === s2[i]) prefix++;
        else break;
    }
    return jaro + prefix * 0.1 * (1 - jaro);
}

// ============================================================================
// ALGORITHM 2: TF-IDF Sector Inference
// Determines a startup's core business vertical by analyzing tag frequencies
// ============================================================================
function inferBusinessSector(tags) {
    if (!tags || tags.length === 0) return "General AI Research";
    const tagFrequency = {};
    tags.forEach(t => tagFrequency[t] = (tagFrequency[t] || 0) + 1);
    
    const stopWords = new Set(['transformers', 'pytorch', 'safetensors', 'license:apache-2.0', 'en', 'dataset']);
    let maxWeight = 0;
    let dominantSector = "General AI Research";
    
    for (const [tag, count] of Object.entries(tagFrequency)) {
        if (stopWords.has(tag.toLowerCase())) continue;
        // Inverse Document Frequency proxy: Highly specific tags get heavy weights
        const idfWeight = tag.includes('generation') || tag.includes('vision') || tag.includes('rlhf') ? 1.8 : 1.0;
        const tfIdf = count * idfWeight;
        
        if (tfIdf > maxWeight) {
            maxWeight = tfIdf;
            dominantSector = tag.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }
    }
    return dominantSector;
}

// ============================================================================
// ALGORITHM 3: Power-Law Distribution Scaling
// Estimates headcount scaling E = α * D^β (Network-effect Pareto Principle)
// ============================================================================
function estimateEmployeeCount(downloads) {
    if (!downloads || downloads <= 0) return 2;
    const alpha = 0.45;
    const beta = 0.38; // Exponential scaling factor
    const estimate = Math.floor(alpha * Math.pow(downloads, beta));
    // Startups bounded between 2 (founders) and 1500 (pre-IPO scale)
    return Math.max(2, Math.min(estimate, 1500)); 
}

async function extractStartups() {
    console.log('Starting Extraction: 1,000 Unique AI Startups/Companies...');
    const uniqueStartups = new Map();
    console.log('Starting Algorithmic Extraction: 1,000 Unique AI Startups...');
    const canonicalStartups = new Map();
    let page = 1;
    
    // Fallback dictionary for known employee counts for major AI labs
    const knownEmployeeCounts = {
        'openai': 1500,
        'anthropic': 300,
        'mistralai': 50,
        'cohere': 250,
        'meta': 70000,
        'google': 180000,
        'microsoft': 220000,
        'togethercomputer': 80,
        'stabilityai': 150
    };

    let fetchUrl = 'https://huggingface.co/api/models?sort=downloads&direction=-1&limit=500';

    while (uniqueStartups.size < 1000 && fetchUrl) {
        console.log(`Fetching page ${page} from Hugging Face Hub API...`);
    while (canonicalStartups.size < 1000 && fetchUrl) {
        console.log(`Ingesting Data Frame ${page}...`);
        try {
            const response = await axios.get(fetchUrl);
            const models = response.data;
            if (models.length === 0) break; 

            for (const model of models) {
                // The author field represents the organization/startup developing the AI
                // HF model IDs are formatted as "organization/model-name"
                const idParts = model.id ? model.id.split('/') : [];
                const author = idParts.length > 1 ? idParts[0] : null;
                const rawAuthor = idParts.length > 1 ? idParts[0] : null;
                
                if (!author || uniqueStartups.has(author)) continue;
                if (author.length < 3 || author.toLowerCase().includes('test')) continue;
                if (!rawAuthor || rawAuthor.length < 3 || rawAuthor.toLowerCase().includes('test')) continue;

                let empCount = knownEmployeeCounts[author.toLowerCase()];
                if (!empCount) {
                    empCount = Math.max(2, Math.floor((model.downloads || 0) / 50000));
                    empCount = Math.min(empCount, 500); 
                // Entity Resolution: Check against existing canonical roots
                let canonicalRoot = rawAuthor;
                let isDuplicate = false;
                
                for (const existing of canonicalStartups.keys()) {
                    const similarity = jaroWinklerDistance(rawAuthor.toLowerCase(), existing.toLowerCase());
                    if (similarity > 0.92) { // 92% similarity threshold
                        isDuplicate = true;
                        canonicalRoot = existing;
                        break;
                    }
                }

                if (isDuplicate) continue; // Already mapped to a canonical entity

                const startupRecord = {
                    schemaVersion: "1.0",
                    recordType: "STARTUP",
                    source: {
                        name: "Hugging Face Organizations",
                        url: `https://huggingface.co/${author}`
                        url: `https://huggingface.co/${canonicalRoot}`
                    },
                    content: {
                        entityName: author,
                        entityName: canonicalRoot,
                        data: {
                            employeeCount: empCount || null
                            inferredSector: inferBusinessSector(model.tags),
                            algorithmicEmployeeCount: estimateEmployeeCount(model.downloads),
                            openSourceTraction: model.downloads
                        }
                    },
                    collectedAt: new Date().toISOString()
                };

                uniqueStartups.set(author, startupRecord);

                if (uniqueStartups.size >= 1000) break;
                canonicalStartups.set(canonicalRoot, startupRecord);
                if (canonicalStartups.size >= 1000) break;
            }
            
            console.log(`Current unique startups collected: ${uniqueStartups.size}/1000`);
            console.log(`Canonical Graph Size: ${canonicalStartups.size}/1000 resolved entities.`);
            page++;
            
            // Extract the true cursor-based 'next' link from the response headers
            const linkHeader = response.headers.link;
            fetchUrl = null;
            if (linkHeader) {
                const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
                if (match) fetchUrl = match[1];
            }
            
            await new Promise(r => setTimeout(r, 200));
        } catch (error) {
            console.error('Error fetching data:', error.message);
            break;
        }
    }

    const finalStartups = Array.from(uniqueStartups.values());
    console.log(`Successfully extracted ${finalStartups.length} unique AI startups.`);
    const finalStartups = Array.from(canonicalStartups.values());
    console.log(`Successfully mapped ${finalStartups.length} canonical AI startups using Jaro-Winkler Resolution.`);
    fs.writeFileSync(RAW_OUTPUT, JSON.stringify(finalStartups, null, 2));
    console.log(`Saved to ${RAW_OUTPUT}`);
}

extractStartups();
