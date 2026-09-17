import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import pLimit from 'p-limit';
import { OpenAI } from 'openai';
import { z } from 'zod';

const DATA_DIR = path.join(process.cwd(), 'data');
const VERIFIED_INPUT = path.join(DATA_DIR, 'verified_models.json');
const SCORED_OUTPUT = path.join(DATA_DIR, 'scored_models.json');
const DLQ_OUTPUT = path.join(DATA_DIR, 'quarantine_dlq.jsonl');

// Configure API Clients for Multi-Tier Fallback
const primaryClient = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || 'dummy-key-for-local-testing'
});

// --- Precise Data Modeling (Zod Schemas) ---

const LLMResponseSchema = z.object({
    description: z.string().min(15).max(350),
    semantic_scores: z.object({
        architecture_elegance: z.number().int().min(0).max(20),
        competitive_differentiation: z.number().int().min(0).max(20),
        real_world_utility: z.number().int().min(0).max(20)
    })
});

const ModelRecordSchema = z.object({
    canonical_name: z.string().min(1),
    provider_company: z.string().min(1),
    context_window: z.number().nullable().optional(),
    official_website: z.string().url().optional().nullable(),
    open_weights_status: z.string(),
    llm_description: z.string().min(10),
    deterministic_score: z.number().min(0).max(40),
    semantic_score: z.number().min(0).max(60),
    quality_score: z.number().min(0).max(100),
    verdict: z.enum(['Exceptional', 'Good', 'Rejected'])
}).passthrough(); // Allow passthrough of raw attributes (like logo_url)

// Helper: Log to Dead-Letter Queue (DLQ)
function appendToDLQ(errorLog) {
    fs.appendFileSync(DLQ_OUTPUT, JSON.stringify(errorLog) + '\n');
}

// 1. Deterministic Scoring Layer (Max 40 Points)
function calculateDeterministicBase(model) {
    let pts = 0;
    const context = parseInt(model.context_window);
    if (context && !isNaN(context) && context >= 4096) {
        pts += Math.min(10, Math.max(0, Math.floor(2 * Math.log2(context / 4096))));
    } else {
        pts += 2;
    }

    if (model.open_weights_status === 'Open-Source (Permissive)') {
        pts += 10;
    } else if (model.open_weights_status === 'Open-Weight (Restrictive Commercial)') {
        pts += 7;
    } else {
        pts += 3;
    }

    // C. Activity & Adoption Signals (20 pts)
    if (model.github_metrics) {
        // Precise Modeling: Actual quantitative metrics
        const { stars, last_commit } = model.github_metrics;
        
        // Stars Logarithmic Scale (Max 10 pts)
        pts += Math.min(10, Math.floor(Math.log10(stars || 1) * 2));
        
        // Recency Decay (Max 10 pts)
        if (last_commit) {
            const daysSinceCommit = (new Date() - new Date(last_commit)) / (1000 * 60 * 60 * 24);
            if (daysSinceCommit < 30) pts += 10;
            else if (daysSinceCommit < 90) pts += 7;
            else if (daysSinceCommit < 180) pts += 4;
            else pts += 1;
        } else {
            pts += 2; 
        }
    } else {
        pts += 12; // Heuristic baseline for non-GitHub models
    }

    return pts;
}

// 2. Hybrid LLM Scoring Pipeline with Multi-Tier Fallback
async function scoreModel(model, limit) {
    return limit(async () => {
        let attempt = 0;
        const maxAttempts = 3;
        
        // Tiered Models Hierarchy
        const fallbackChain = [
            "google/gemini-2.5-flash", // Primary
            "meta-llama/llama-3.3-70b-instruct", // Secondary
            "mistralai/mistral-large-2411" // Tertiary
        ];

        while (attempt < maxAttempts) {
            try {
                console.log(`[Attempt ${attempt+1}] Scoring model: ${model.canonical_name}`);
                const deterministicScore = calculateDeterministicBase(model);
                
                const criticPrompt = `As the CRITIC, analyze "${model.canonical_name}". Highlight flaws, architectural limitations, and reasons it might fail in production. Be aggressive.`;
                const advocatePrompt = `As the ADVOCATE, analyze "${model.canonical_name}". Highlight unique capabilities, enterprise utility, and competitive moats. Be highly optimistic.`;
                
                let llmResult;
                const currentLLM = fallbackChain[attempt % fallbackChain.length]; 

                if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'dummy-key-for-local-testing') {
                    // Multi-Agent Concurrency
                    const [criticRes, advocateRes] = await Promise.all([
                        primaryClient.chat.completions.create({ model: currentLLM, messages: [{ role: "user", content: criticPrompt }], temperature: 0.7 }),
                        primaryClient.chat.completions.create({ model: currentLLM, messages: [{ role: "user", content: advocatePrompt }], temperature: 0.7 })
                    ]);
                    
                    const criticArg = criticRes.choices[0].message.content;
                    const advocateArg = advocateRes.choices[0].message.content;

                    const judgePrompt = `
                    You are the JUDGE. Evaluate the AI model "${model.canonical_name}".
                    CRITIC ARGUMENT: ${criticArg}
                    ADVOCATE ARGUMENT: ${advocateArg}
                    
                    Resolve this debate into a final Semantic Score (Max 60 points).
                    Return ONLY a valid JSON object matching this schema:
                    {
                        "description": "2 concise sentences explaining architecture and utility.",
                        "semantic_scores": {
                            "architecture_elegance": 18, 
                            "competitive_differentiation": 14, 
                            "real_world_utility": 15 
                        }
                    }`;

                    const judgeCompletion = await primaryClient.chat.completions.create({
                        model: currentLLM,
                        messages: [{ role: "user", content: judgePrompt }],
                        response_format: { type: "json_object" },
                        temperature: 0.1
                    });
                    
                    const rawJson = JSON.parse(judgeCompletion.choices[0].message.content);
                    llmResult = LLMResponseSchema.parse(rawJson); 
                } else {
                    // Mock Evaluation
                    const mockBase = Math.floor(Math.random() * 10) + 10;
                    const rawMock = {
                        description: `The ${model.canonical_name} by ${model.provider_company} introduces massive scaling improvements. It achieves top decile performance in reasoning.`,
                        semantic_scores: {
                            architecture_elegance: mockBase,
                            competitive_differentiation: mockBase - 2,
                            real_world_utility: mockBase + 1
                        }
                    };
                    llmResult = LLMResponseSchema.parse(rawMock);
                }

                const sScores = llmResult.semantic_scores;
                const semanticTotal = sScores.architecture_elegance + sScores.competitive_differentiation + sScores.real_world_utility;
                const finalScore = deterministicScore + semanticTotal;

                const candidateRecord = {
                    ...model,
                    llm_description: llmResult.description,
                    deterministic_score: deterministicScore,
                    semantic_score: semanticTotal,
                    quality_score: finalScore,
                    verdict: finalScore >= 80 ? "Exceptional" : (finalScore >= 60 ? "Good" : "Rejected")
                };

                // Precise Modeling: Zod protects the final dataset export
                const validatedRecord = ModelRecordSchema.parse(candidateRecord);
                return validatedRecord;

            } catch (error) {
                // Determine if it was a Schema failure (Zod) or API failure (Network)
                const isSchemaError = error instanceof z.ZodError;
                const errorCode = isSchemaError ? 'SCHEMA_VALIDATION_FAILED' : 
                                 (error.status === 429 ? 'HTTP_429_RATE_LIMIT' : 'LLM_EVAL_FAILURE');

                attempt++;
                if (attempt >= maxAttempts || isSchemaError) { 
                    // Do not retry on schema validation failures, they represent bad LLM reasoning
                    console.error(`Quarantining ${model.canonical_name}: ${errorCode}`);
                    appendToDLQ({
                        entity_id: model.canonical_name,
                        phase: 'score.js',
                        error_code: errorCode,
                        details: isSchemaError ? error.errors : error.message,
                        http_status: error.status || 500,
                        attempt_count: attempt,
                        payload_snapshot: { name: model.canonical_name },
                        timestamp: new Date().toISOString()
                    });
                    return null;
                }
                
                // Exponential Backoff with Full Jitter
                const baseSleep = 2000;
                const sleepTime = baseSleep * Math.pow(2, attempt) * Math.random();
                console.warn(`Fallback triggered for ${model.canonical_name}. Retrying in ${Math.round(sleepTime)}ms...`);
                await new Promise(res => setTimeout(res, sleepTime));
            }
        }
    });
}

async function runScoring() {
    console.log('Starting Phase 5: Zod Validated Scoring Engine with Fallbacks...');
    if (!fs.existsSync(VERIFIED_INPUT)) {
        console.error(`Verified data file not found: ${VERIFIED_INPUT}`);
        return;
    }

    const verifiedModels = JSON.parse(fs.readFileSync(VERIFIED_INPUT, 'utf-8'));
    const limit = pLimit(5);

    const scoringPromises = verifiedModels.map(model => scoreModel(model, limit));
    const scoredResults = await Promise.all(scoringPromises);

    const validResults = scoredResults.filter(Boolean);
    const finalModels = validResults.filter(m => m.quality_score >= 60);
    const rejected = validResults.filter(m => m.quality_score < 60);

    console.log(`Accepted ${finalModels.length} models. Rejected ${rejected.length} models.`);
    
    fs.writeFileSync(SCORED_OUTPUT, JSON.stringify(finalModels, null, 2));
    fs.writeFileSync(path.join(DATA_DIR, 'rejected_models.json'), JSON.stringify(rejected, null, 2));
    
    console.log(`Saved scored data to ${SCORED_OUTPUT}`);
}

runScoring();
