from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.cluster import DBSCAN
import uvicorn
import logging

# Initialize FastAPI App
app = FastAPI(title="Semantic Vector Clustering API", version="1.0")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ml_worker")

# Load lightweight embedding model (MiniLM is excellent for fast semantic tensor generation)
logger.info("Loading PyTorch embedding model...")
embedder = SentenceTransformer('all-MiniLM-L6-v2')
logger.info("Embedding model loaded successfully.")

# --- Data Models ---
class RawModel(BaseModel):
    id: str
    name: str
    provider_company: str
    description: Optional[str] = ""
    pipeline_tag: Optional[str] = None
    context_window: Optional[int] = None
    source: str

class ClusterRequest(BaseModel):
    models: List[RawModel]

class CanonicalModel(BaseModel):
    canonical_name: str
    provider_company: str
    context_window: Optional[int] = None
    pipeline_tag: Optional[str] = None
    description: str
    providers: List[str]
    cluster_size: int

# --- Tensor Operations & Clustering ---
@app.post("/cluster", response_model=List[CanonicalModel])
async def cluster_models(request: ClusterRequest):
    data = request.models
    if not data:
        return []

    logger.info(f"Received {len(data)} raw models for semantic clustering.")

    # 1. Corpus Generation
    # We embed a composite string to capture semantic meaning (Name + Provider + Tag)
    corpus = [
        f"{m.name} {m.provider_company} {m.pipeline_tag or ''}".strip().lower()
        for m in data
    ]

    # 2. Embedding Generation (PyTorch Tensors)
    logger.info("Executing PyTorch tensor matrix multiplications...")
    embeddings = embedder.encode(corpus, convert_to_numpy=True, normalize_embeddings=True)
    
    # 3. Density-Based Clustering (DBSCAN)
    # Cosine distance = 1 - Cosine Similarity. Since embeddings are normalized, 
    # we can use 'cosine' metric. eps=0.15 means ~0.85 cosine similarity boundary.
    logger.info("Running DBSCAN clustering...")
    clustering_model = DBSCAN(eps=0.15, min_samples=1, metric='cosine')
    clustering_model.fit(embeddings)
    labels = clustering_model.labels_

    # 4. Canonical Electing (Cluster Resolution)
    clusters: Dict[int, List[RawModel]] = {}
    for idx, label in enumerate(labels):
        if label not in clusters:
            clusters[label] = []
        clusters[label].append(data[idx])

    canonical_results = []
    
    for label, members in clusters.items():
        # Sort members to elect the cleanest/shortest canonical root
        sorted_members = sorted(members, key=lambda x: len(x.name))
        canonical_base = sorted_members[0]
        
        # Deduplicate providers array
        providers_set = list(set([m.source for m in members]))
        
        # Determine best available context window
        context_windows = [m.context_window for m in sorted_members if m.context_window]
        best_context = max(context_windows) if context_windows else None

        canonical_results.append(CanonicalModel(
            canonical_name=canonical_base.name,
            provider_company=canonical_base.provider_company.replace('Inc.', '').replace('LLC', '').strip(),
            context_window=best_context,
            pipeline_tag=canonical_base.pipeline_tag,
            description=canonical_base.description,
            providers=providers_set,
            cluster_size=len(members)
        ))

    logger.info(f"Clustering complete. Distilled {len(data)} records into {len(canonical_results)} canonical roots.")
    return canonical_results

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

