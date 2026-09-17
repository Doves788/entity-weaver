import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';

const DATA_DIR = path.join(process.cwd(), 'data');
const RAW_OUTPUT = path.join(DATA_DIR, 'raw_models.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Phase 2: Data Extraction Strategy
// 1. Primary Source: OpenRouter API
async function fetchModelsDevData() {
    console.log('Fetching from Primary Source (OpenRouter API acting as Models.dev)...');
    console.log('Fetching from OpenRouter API...');
    try {
        const response = await axios.get('https://openrouter.ai/api/v1/models');
        return response.data.data.map(model => ({
            id: model.id,
            name: model.name,
            provider_company: model.id.split('/')[0],
            context_window: model.context_length,
            description: model.description || '',
            pricing: model.pricing,
            source: 'API_Registry'
        }));
    } catch (error) {
        console.error('Error fetching API registry:', error.message);
        return [];
    }
}

// 2. Hugging Face: Scaled up to fetch top 1000 models
async function fetchHuggingFaceTopModels() {
    console.log('Fetching from Hugging Face Hub API...');
    console.log('Fetching from Hugging Face Hub API (Scaled to 1000)...');
    try {
        const response = await axios.get('https://huggingface.co/api/models', {
            params: { sort: 'downloads', direction: -1, limit: 200 }
        });
        return response.data.map(model => ({
            id: model.id,
            name: model.id.split('/')[1] || model.id,
            provider_company: model.author || model.id.split('/')[0],
            pipeline_tag: model.pipeline_tag,
            tags: model.tags,
            source: 'HuggingFace'
        }));
        // Fetch 500 models across 2 pages
    console.log('Fetching from Hugging Face Hub API (with ETag CDC)...');
    try {
        let allModels = [];
        for (let i = 0; i < 2; i++) {
            const response = await axios.get('https://huggingface.co/api/models', {
                params: { sort: 'downloads', direction: -1, limit: 500 },
                headers: i > 0 ? { 'Link': `<https://huggingface.co/api/models?sort=downloads&direction=-1&limit=500&cursor=${i}>; rel="next"` } : {}
            });
            allModels = allModels.concat(response.data.map(model => ({
                id: model.id,
                name: model.id.split('/')[1] || model.id,
                provider_company: model.author || model.id.split('/')[0],
                pipeline_tag: model.pipeline_tag,
                tags: model.tags,
                source: 'HuggingFace'
            })));
            const cacheKey = `hf_page_${i}`;
            const headers = i > 0 ? { 'Link': `<https://huggingface.co/api/models?sort=downloads&direction=-1&limit=500&cursor=${i}>; rel="next"` } : {};
            
            // Inject ETag if available
            if (etagCache[cacheKey]) {
                headers['If-None-Match'] = etagCache[cacheKey];
            }

            try {
                const response = await axios.get('https://huggingface.co/api/models', {
                    params: { sort: 'downloads', direction: -1, limit: 500 },
                    headers: headers
                });
                
                // Save new ETag and payload
                if (response.headers['etag']) {
                    etagCache[cacheKey] = response.headers['etag'];
                    fs.writeFileSync(CACHE_FILE, JSON.stringify(etagCache, null, 2));
                }
                
                const formattedData = response.data.map(model => ({
                    id: model.id,
                    name: model.id.split('/')[1] || model.id,
                    provider_company: model.author || model.id.split('/')[0],
                    pipeline_tag: model.pipeline_tag,
                    tags: model.tags,
                    source: 'HuggingFace'
                }));
                
                payloadCache[cacheKey] = formattedData;
                fs.writeFileSync(path.join(DATA_DIR, 'hf_payload_cache.json'), JSON.stringify(payloadCache, null, 2));
                allModels = allModels.concat(formattedData);
                
            } catch (err) {
                if (err.response && err.response.status === 304) {
                    console.log(`HTTP 304 Not Modified for Hugging Face page ${i}. Using cached delta.`);
                    allModels = allModels.concat(payloadCache[cacheKey] || []);
                } else {
                    throw err;
                }
            }
        }
        return allModels;
    } catch (error) {
        console.error('Error fetching Hugging Face data:', error.message);
        return [];
    }
}

async function scrapeTAAFTModels() {
    console.log('Scraping Theres An AI For That (Models)...');
// 3. GitHub API: Discover open-source models/repos
async function fetchGitHubModels() {
    console.log('Fetching AI Models from GitHub Repositories...');
    try {
        const response = await axios.get('https://theresanaiforthat.com/models/', {
        const response = await axios.get('https://api.github.com/search/repositories', {
            params: { q: 'topic:llm OR topic:large-language-model OR topic:ai-model', sort: 'stars', order: 'desc', per_page: 100 },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                'User-Agent': 'AI-Model-Curator/1.0',
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        return response.data.items.map(repo => ({
            id: repo.full_name,
            name: repo.name,
            provider_company: repo.owner.login,
            description: repo.description,
            pipeline_tag: repo.language || 'Code',
            source: 'GitHub'
        }));
    } catch (error) {
        console.error('Error fetching GitHub models:', error.message);
        return [];
    }
}

// 4. Civitai API: Gather image/video generation models
async function fetchCivitaiModels() {
    console.log('Fetching Image/Video Models from Civitai...');
    try {
        const response = await axios.get('https://civitai.com/api/v1/models', {
            params: { limit: 100, sort: 'Highest Rated' }
        });
        
        return response.data.items.map(model => ({
            id: model.id.toString(),
            name: model.name,
            provider_company: model.creator.username,
            pipeline_tag: model.type || 'Image Generation',
            description: model.description ? model.description.substring(0, 200) : '',
            source: 'Civitai'
        }));
    } catch (error) {
        console.error('Error fetching Civitai models:', error.message);
        return [];
    }
}

// 5. PapersWithCode: Trending ML Methods/Architectures
async function scrapePapersWithCode() {
    console.log('Scraping PapersWithCode Methods...');
    try {
        const response = await axios.get('https://paperswithcode.com/methods', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $ = cheerio.load(response.data);
        const scraped = [];
        $('.model-item, .item, article').each((i, el) => {
            const name = $(el).find('h2, .name, .title').text().trim();
            const developer = $(el).find('.developer, .company, .subtitle').text().trim();
        
        $('.method-block').each((i, el) => {
            if (i >= 100) return false; // Limit to top 100
            const name = $(el).find('h4').text().trim();
            if (name) {
                scraped.push({
                    name,
                    provider_company: developer || 'Unknown',
                    source: 'TAAFT_Scrape'
                    provider_company: 'PapersWithCode Community',
                    pipeline_tag: 'Architecture / Method',
                    source: 'PapersWithCode'
                });
            }
        });
        return scraped;
    } catch (error) {
        console.error('Error scraping TAAFT (likely anti-bot):', error.message);
        console.error('Error scraping PapersWithCode:', error.message);
        return [];
    }
}

async function runExtraction() {
    console.log('Starting Phase 2: Data Extraction...');
    const [apiData, hfData, scrapedData] = await Promise.all([
    console.log('Starting Phase 2: Mass Data Extraction...');
    const [apiData, hfData, githubData, civitaiData, pwcData] = await Promise.all([
        fetchModelsDevData(),
        fetchHuggingFaceTopModels(),
        scrapeTAAFTModels()
        fetchGitHubModels(),
        fetchCivitaiModels(),
        scrapePapersWithCode()
    ]);

    const combined = [...apiData, ...hfData, ...scrapedData];
    console.log(`Extracted ${combined.length} total raw records.`);
    const combined = [...apiData, ...hfData, ...githubData, ...civitaiData, ...pwcData];
    console.log(`Extracted ${combined.length} total raw records across 5 sources.`);
    
    fs.writeFileSync(RAW_OUTPUT, JSON.stringify(combined, null, 2));
    console.log(`Saved raw data to ${RAW_OUTPUT}`);
}

runExtraction();

