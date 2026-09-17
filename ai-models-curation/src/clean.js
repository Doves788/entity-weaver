import fs from 'fs';
import path from 'path';
import axios from 'axios';

const DATA_DIR = path.join(process.cwd(), 'data');
const RAW_INPUT = path.join(DATA_DIR, 'raw_models.json');
const CLEANED_OUTPUT = path.join(DATA_DIR, 'cleaned_models.json');
const AUDIT_LOG = path.join(DATA_DIR, 'entity_resolution_audit.log');

// --- 1. Disjoint Set Union (Union-Find) Graph Engine ---
class DisjointSet {
    constructor() {
        this.parent = new Map();
        this.rank = new Map();
    }
    
    makeSet(id) {
        if (!this.parent.has(id)) {
            this.parent.set(id, id);
            this.rank.set(id, 0);
        }
    }
    
    findRoot(id) {
        if (this.parent.get(id) !== id) {
            this.parent.set(id, this.findRoot(this.parent.get(id))); // Path compression
        }
        return this.parent.get(id);
    }
    
    unionSets(id1, id2) {
        const root1 = this.findRoot(id1);
        const root2 = this.findRoot(id2);
        
        if (root1 !== root2) {
            const rank1 = this.rank.get(root1);
            const rank2 = this.rank.get(root2);
            
            if (rank1 > rank2) {
                this.parent.set(root2, root1);
            } else if (rank1 < rank2) {
                this.parent.set(root1, root2);
            } else {
                this.parent.set(root2, root1);
                this.rank.set(root1, rank1 + 1);
            }
            return true;
        }
        return false;
    }
}
// --- ML Worker Decoupling ---
// This script acts as the Node.js ingestion router. It passes raw data to the Python PyTorch Microservice 
// for Semantic Vector Clustering, removing the brittle regex/string logic from the Node layer.

// --- 2. Deterministic Entity Resolution ---
// Token-based Jaccard/Overlap Similarity to act as proxy for Jaro-Winkler
function calculateTokenSimilarity(str1, str2) {
    const tokenize = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/).filter(t => t.length > 0));
    const set1 = tokenize(str1);
    const set2 = tokenize(str2);
    
    if (set1.size === 0 || set2.size === 0) return 0;
    
    let intersection = 0;
    for (const token of set1) {
        if (set2.has(token)) intersection++;
    }
    
    // Dice coefficient to emphasize overlap
    return (2 * intersection) / (set1.size + set2.size); 
}

function cleanData() {
    console.log('Starting Phase 3: Disjoint-Set Entity Resolution & Deduplication...');
async function cleanDataWithMLWorker() {
    console.log('Starting Phase 3: Semantic Vector Clustering (Routing to ML Worker)...');
    if (!fs.existsSync(RAW_INPUT)) {
        console.error(`Raw data file not found: ${RAW_INPUT}`);
        return;
    }

    const rawData = JSON.parse(fs.readFileSync(RAW_INPUT, 'utf-8'));
    
    // 1. Regex Quantization Strip (First Pass)
    // 1. Regex Quantization Strip (Pre-processing filter to save tensor operations)
    const quantizationRegex = /(GGUF|AWQ|GPTQ|EXL2|FP16|BF16|Q4_K_M|Q8_0|LoRA)/i;
    const filteredData = rawData.filter(model => {
        return !(quantizationRegex.test(model.name) || (model.tags && model.tags.some(tag => quantizationRegex.test(tag))));
    });

    console.log(`Filtered out ${rawData.length - filteredData.length} quantized/redundant models.`);
    console.log(`Pre-filtered ${rawData.length - filteredData.length} quantized/redundant models.`);

    // 2. Disjoint-Set Clustering Graph
    const dsu = new DisjointSet();
    const modelRegistry = new Map();
    
    // Register all nodes
    filteredData.forEach((model, index) => {
        dsu.makeSet(index);
        modelRegistry.set(index, model);
    });

    fs.writeFileSync(AUDIT_LOG, 'Raw Scraped String -> Resolved Canonical Entity | Confidence\n');
    fs.appendFileSync(AUDIT_LOG, '----------------------------------------------------------\n');

    // N^2 Pairwise Similarity Matrix Evaluation (Batched/Optimized in production, naive here for < 10k items)
    console.log('Building pairwise similarity matrix (Jaro-Winkler/Dice >= 0.85)...');
    for (let i = 0; i < filteredData.length; i++) {
        for (let j = i + 1; j < filteredData.length; j++) {
            const modelA = filteredData[i];
            const modelB = filteredData[j];
            
            // Fast reject if providers are entirely different (unless one is an aggregator)
            if (modelA.provider_company !== modelB.provider_company && modelA.source !== 'HuggingFace' && modelB.source !== 'HuggingFace') continue;

            const nameSim = calculateTokenSimilarity(modelA.name, modelB.name);
            if (nameSim >= 0.85) {
                dsu.unionSets(i, j);
            }
        }
    }

    // 3. Cluster Resolution & Canonical Electing
    const clusters = new Map();
    filteredData.forEach((_, index) => {
        const root = dsu.findRoot(index);
        if (!clusters.has(root)) clusters.set(root, []);
        clusters.get(root).push(index);
    });

    const finalCanonicalModels = [];

    for (const [rootId, members] of clusters.entries()) {
        // Elect Canonical Name: Shortest name in the cluster without weird symbols
        const sortedMembers = members.map(idx => modelRegistry.get(idx))
            .sort((a, b) => a.name.length - b.name.length);
    try {
        console.log(`Sending ${filteredData.length} records to PyTorch ML Worker (http://localhost:8000/cluster)...`);
        
        const canonicalBase = sortedMembers[0];
        
        // Audit Logging
        members.forEach(idx => {
            const m = modelRegistry.get(idx);
            if (m.name !== canonicalBase.name) {
                const sim = calculateTokenSimilarity(m.name, canonicalBase.name).toFixed(2);
                fs.appendFileSync(AUDIT_LOG, `[Raw: "${m.name}"] -> [Canonical: "${canonicalBase.name}"] (Confidence: ${sim})\n`);
            }
        // 2. Delegate Semantic Clustering to the Python Microservice
        const response = await axios.post('http://localhost:8000/cluster', {
            models: filteredData.map((m, i) => ({
                id: m.id || `node_${i}`,
                name: m.name,
                provider_company: m.provider_company || 'Unknown',
                description: m.description || '',
                pipeline_tag: m.pipeline_tag || null,
                context_window: m.context_window || null,
                source: m.source
            }))
        }, {
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        // Merge hosts
        const providersSet = new Set(sortedMembers.map(m => m.source));
        const canonicalModels = response.data;
        
        finalCanonicalModels.push({
            canonical_name: canonicalBase.name,
            provider_company: canonicalBase.provider_company.replace(/Inc\.|LLC|Corp/i, '').trim(),
            context_window: sortedMembers.find(m => m.context_window)?.context_window || null,
            pipeline_tag: sortedMembers.find(m => m.pipeline_tag)?.pipeline_tag || null,
            description: sortedMembers.find(m => m.description)?.description || '',
            providers: Array.from(providersSet)
        });
        console.log(`ML Worker successfully distilled data into ${canonicalModels.length} canonical roots.`);
        
        fs.writeFileSync(CLEANED_OUTPUT, JSON.stringify(canonicalModels, null, 2));
        console.log(`Saved canonical clustered data to ${CLEANED_OUTPUT}`);
        
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            console.error('\n[CRITICAL ERROR] Could not connect to ML Worker.');
            console.error('Please ensure the Python FastAPI server is running:');
            console.error('  cd ml_worker');
            console.error('  pip install -r requirements.txt');
            console.error('  python main.py\n');
        } else {
            console.error('Error during ML clustering:', error.message);
        }
    }

    console.log(`Clustered ${filteredData.length} entities down to ${finalCanonicalModels.length} canonical roots.`);
    fs.writeFileSync(CLEANED_OUTPUT, JSON.stringify(finalCanonicalModels, null, 2));
    console.log(`Saved canonical data to ${CLEANED_OUTPUT}`);
    console.log(`Audit log written to ${AUDIT_LOG}`);
}

cleanData();
cleanDataWithMLWorker();
