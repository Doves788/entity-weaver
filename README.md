# Enterprise AI Data Intelligence Pipeline

This repository contains a suite of production-grade, fault-tolerant data ingestion pipelines designed to extract, normalize, and enrich entities across the global AI ecosystem.

## Architecture Overview

The system is decoupled into highly specialized micro-pipelines, prioritizing data fidelity, API-first discovery, and algorithmic entity resolution.

### 1. Startups & Companies Pipeline (`/ai-startups-pipeline`)
*   **Discovery Engine:** Cursor-based API pagination traversing massive Hugging Face organizational graphs.
*   **Entity Resolution:** Custom **Jaro-Winkler Distance** algorithm (92% threshold) to canonicalize dirty organization strings (e.g., merging `OpenAI` and `OpenAI Inc`).
*   **Sector Inference:** A lightweight TF-IDF proxy mechanism applying term weights to infer core business verticals (e.g., distinguishing Vision Labs from generic AI startups).
*   **Scale Heuristics:** Power-Law (Pareto) mathematical distribution to synthesize and proxy startup employee counts based on network-effect download traction.

### 2. Research Papers Pipeline (`/ai-research-pipeline`)
*   **Ingestion:** Mass XML parsing from the Arxiv REST API targeting `cs.AI`, `cs.CV`, and `cs.LG`.
*   **Cross-Referencing Telemetry:** Connects semantic paper titles to live GitHub open-source repositories via the GitHub Search/GraphQL APIs.
*   **Resilience:** Implements a strict `2,100ms` async sleep throttle to bypass GitHub's 30-req/min secondary rate limits without triggering `403` or `429` errors.

### 3. AI Models Curation Pipeline (`/ai-models-curation`)
*   **Decoupled ML Worker:** Offloads string deduplication to a Python FastAPI microservice utilizing `sentence-transformers` and `DBSCAN` (Density-Based Spatial Clustering) for pure semantic tensor resolution.
*   **Multi-Agent LLM Evaluator:** Evaluates subjective semantic scores using a 3-agent adversarial debate (Critic vs. Advocate, resolved by a Judge).
*   **Fault Tolerance:** Zod runtime schema validation, Decorrelated Full Jitter backoff, and a rotating Multi-Tier LLM Fallback Chain (Gemini Flash ➔ LLaMA 3.3 ➔ Mistral Large). Unrecoverable failures are written to an idempotent Write-Ahead Log / Dead Letter Queue (DLQ).

## Setup & Execution

### Prerequisites
*   Node.js (v18+)
*   Python 3.10+ (For ML Worker)

### Running the Startups Pipeline
\`\`\`bash
cd ai-startups-pipeline
npm install
node src/extract.js
node src/export.js
\`\`\`

### Running the Research Papers Pipeline
\`\`\`bash
cd ai-research-pipeline
npm install
node src/extract.js
node src/verify.js
node src/export.js
\`\`\`

