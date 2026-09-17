# AI Models Curation Pipeline

This repository contains an end-to-end data pipeline designed to curate a high-quality dataset of AI models from multiple sources, fulfilling the trial execution blueprint for the Models module.

## Architecture

The curation pipeline is modularized into five distinct phases, executed sequentially using Node.js.

1. **Extraction (`src/extract.js`)**: Ingests raw data from three primary sources:
   - *Models API / OpenRouter Registry*: Fetches base models, context limits, and endpoints via structured JSON.
   - *Hugging Face Hub API*: Queries top-downloaded open-source models to discover community favorites and architectural tags.
   - *Theres An AI For That*: Web scraping via `axios` and `cheerio` with custom headers to mitigate anti-bot protections.

2. **Normalization & Deduplication (`src/clean.js`)**: 
   - Uses regex filtering to strip noisy quantization formats `/(GGUF|AWQ|GPTQ|EXL2|FP16|BF16|Q4_K_M|Q8_0|LoRA)/i`.
   - Normalizes legal prefixes and duplicate casing.
   - Maps serving variants to a single base entity using a composite primary key (`canonical_name::provider_company`), merging provider arrays instead of generating duplicate rows.

3. **Official Verification (`src/verify.js`)**:
   - Computes canonical domain URLs for each provider.
   - Retrieves official logos and validates them ensuring HTTP 200 responses and proper image content types.
   - Classifies models functionally as either "Open-Source (Permissive)" or "Open-Weight (Restrictive Commercial)" based on heuristic provider tagging.

4. **LLM Scoring (`src/score.js`)**:
   - Utilizes `p-limit` for concurrent management to prevent rate-limiting against the LLM API endpoint.
   - Sends a strict prompt enforcing a specific JSON format output based on a 100-point rubric (capability, usefulness, adoption, etc.).
   - Includes a programmatic threshold gating models with a score `< 60`.

5. **Export (`src/export.js`)**:
   - Assembles the finalized, structured models into a robust CSV utilizing `json2csv`.
   - Adheres to the exact column schemas required (Model Name, Company / Provider, Quality Score, etc.).

## Setup & Execution

### Requirements
- Node.js (v18+)
- OpenRouter / OpenAI API Key

### Installation

```bash
git clone <repository-url>
cd ai-models-curation
npm install
```

### Environment
Create a `.env` file and populate your keys:
```env
OPENROUTER_API_KEY=your_api_key_here
```

### Running the Pipeline
Run the scripts sequentially:

```bash
node src/extract.js
node src/clean.js
node src/verify.js
node src/score.js
node src/export.js
```

## Output
The final CSV dataset will be placed at `data/final_models.csv`, which is then imported into Google Sheets for the final delivery requirement.

