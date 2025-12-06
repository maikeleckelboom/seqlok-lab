# Vector Database Domain Guide for Dekzer

**Purpose**: Map the entire vector DB / embedding space relevant to Dekzer and Ghost DJ.

**Audience**: Future Dekzer devs who know TypeScript + Seqlok, but might be new to embeddings/vector DBs. This is not a
research doc—it's a product/engineering guide for your stack.

---

## V1 Cut (Start Here)

**If you're just trying to ship the first version, do *only* this:**

### Embedding

- **Audio**: Simple spectral summary (MFCC + tempo + energy + spectral centroid)
- **Text**: Title + artist + tags using one text embedding model (sentence-transformers or similar)

### Storage

- In-memory array or simple JSON file
- Brute-force cosine search (it's fast enough for < 10k tracks)

### Features

- "Tracks like this" (k-nearest neighbors)
- "Seed crate from 1–3 tracks" with BPM + key filters

### What You Skip for V1

- Neural audio models (CLAP, MERT) — add later as enhancement
- Segment-level embeddings — wait until transitions are the bottleneck
- Moment embeddings — wait until Ghost DJ planning is real
- Gesture embeddings — way later, if ever
- External vector DB — overkill until you have 50k+ tracks

**Everything below is the full map. Come back when V1 is shipping and you want more.**

---

**Reading order**: You don't need to master everything at once. Start with geometry, move to simple pipelines, then DB +
hybrid search, then Dekzer-specific spaces, and finally feedback loops.

**Key principle**: All of this is *offline / slow brain* stuff. It layers on top of Seqlok without touching the sacred
audio callback.

**Legend**:

- **[CORE V1]** — Must exist for first shipping version
- **[CORE V2]** — Required for Ghost DJ v0 / segment-aware suggestions
- **[OPTIONAL]** — Nice to have, build when usage proves value

> **Note on code examples**: Code is illustrative patterns, not a frozen API. Real types will live under
`@dekzer/vector` or similar package.

---

## 1. Geometry & Embeddings (The Math-y Core)

This is the "what even *is* this space?" cluster.

### 1.1 Embedding Models

#### Modalities

| Modality           | What Gets Embedded                         | Example Models                                                  |
|--------------------|--------------------------------------------|-----------------------------------------------------------------|
| **Text**           | Track titles, tags, DJ notes, user prompts | OpenAI text-embedding-3, Cohere embed-v3, sentence-transformers |
| **Audio**          | Tracks, stems, segments, "moments"         | CLAP, MERT, Jukebox, wav2vec2, custom spectral                  |
| **Actions/Macros** | Sequences of parameter changes             | Custom encoder (time-series → vector)                           |
| **Cross-modal**    | Audio + text in shared space               | CLAP, AudioCLIP, LAION-CLAP                                     |

#### Audio Embedding Models (Deep Dive)

**General-purpose audio:**

- **CLAP (Contrastive Language-Audio Pretraining)**: Joint audio-text space, can search audio by text description.
  LAION-CLAP is the open version.
- **MERT (Music Understanding Model)**: Trained specifically on music, good at rhythm/melody/timbre. 12 transformer
  layers, ~95M params.
- **Jukebox embeddings**: OpenAI's music model; embeddings from intermediate layers capture musical structure.
- **wav2vec 2.0**: Self-supervised speech model, but works for music onset/rhythm features.

**DJ-specific considerations:**

- Most models trained on "normal" music (pop, classical, jazz)
- Hard-tek, gabber, industrial may be underrepresented → expect weird embedding space regions
- Consider fine-tuning or using multiple models (one for rhythm, one for timbre)

**Spectral/handcrafted (simpler, more predictable):**

- MFCCs (Mel-frequency cepstral coefficients)
- Chroma features (pitch class profiles)
- Spectral contrast, centroid, rolloff
- Rhythm features (onset strength, tempogram)

**Practical recommendation for V1:**

```
Track embedding = concat(
  spectral_summary,      // handcrafted: MFCCs, chroma, centroid (fast, predictable)
  rhythm_embedding,      // tempogram-based or beat-aligned features
  neural_embedding       // CLAP or MERT for "vibe" (optional, can add later)
)
```

**On-device vs cloud implications:**

- Spectral/rhythm features can be computed entirely on-device with no external model dependency → keeps "
  privacy-friendly" and "offline" modes viable
- Neural embeddings (CLAP, MERT) may require GPU/cloud in early iterations → treat as additive enhancement, not
  foundational
- This supports the "no cloud lock-in" philosophy: Dekzer works offline, cloud makes it smarter

#### Dimensionality & Precision

| Dimension | Tradeoff                                 |
|-----------|------------------------------------------|
| 128-256   | Fast, small, may lose nuance             |
| 512-768   | Sweet spot for most use cases            |
| 1024-2048 | More expressive, heavier storage/compute |

| Precision        | Storage     | Speed    | Quality                           |
|------------------|-------------|----------|-----------------------------------|
| Float32          | 4 bytes/dim | Baseline | Full                              |
| Float16          | 2 bytes/dim | ~Same    | Minimal loss                      |
| Int8 (quantized) | 1 byte/dim  | Faster   | ~95-99% quality                   |
| Binary           | 1 bit/dim   | Fastest  | ~90% quality, good for pre-filter |

**For Dekzer V1**: Float32 or Float16 at 512-768 dimensions is plenty. Quantize later if storage becomes an issue.

#### Multi-Embedding Setups

**Option A: Separate spaces**

```ts
interface TrackEmbeddings {
  audioVec: Float32Array;   // 512-dim, from spectral + neural
  textVec: Float32Array;    // 384-dim, from title + tags + notes
  rhythmVec: Float32Array;  // 128-dim, beat/tempo features
}
```

Query each space separately, combine scores.

**Option B: Shared multi-modal space (CLIP-style)**

- Audio and text live in same vector space
- Can search audio by text: `"dark industrial techno"` → nearest audio vectors
- CLAP/AudioCLIP do this

**Recommendation**: Start with separate spaces (simpler, more controllable), add cross-modal later.

### 1.2 Distance & Similarity

#### Metrics

| Metric                 | Formula                 | Properties                                             |
|------------------------|-------------------------|--------------------------------------------------------|
| **Cosine similarity**  | `dot(a,b) / (‖a‖·‖b‖)`  | Direction only, ignores magnitude. Range [-1, 1].      |
| **Cosine distance**    | `1 - cosine_similarity` | Range [0, 2].                                          |
| **L2 (Euclidean)**     | `√Σ(aᵢ - bᵢ)²`          | Direction + magnitude. Unbounded.                      |
| **Dot product**        | `Σ(aᵢ · bᵢ)`            | Fast. If vectors normalized, equals cosine similarity. |
| **Inner product (IP)** | Same as dot product     | Common DB terminology.                                 |

#### When to Use What

- **Normalized vectors + dot product**: Fastest, equivalent to cosine. Best default.
- **Cosine**: When you can't pre-normalize, or want explicit similarity semantics.
- **L2**: When magnitude matters (e.g., "energy" embedded in vector norm).

**For Dekzer**: Normalize all vectors at embedding time, use dot product / inner product for search.

#### Practical Code

```ts
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalize(source: Float32Array): Float32Array {
  let normSquared = 0;
  for (let i = 0; i < source.length; i += 1) {
    const v = source[i];
    normSquared += v * v;
  }
  // Handle zero vector: return copy to avoid surprising mutation
  if (normSquared === 0) {
    const clone = new Float32Array(source.length);
    for (let i = 0; i < source.length; i += 1) {
      clone[i] = source[i];
    }
    return clone;
  }
  const norm = Math.sqrt(normSquared);
  const result = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    result[i] = source[i] / norm;
  }
  return result;
}

// If pre-normalized, just dot product
function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
```

### 1.3 Geometry Tricks

#### Vector Arithmetic

The famous `king - man + woman = queen` idea. Does it work for music?

```ts
// Hypothetical mood navigation
const darkerTrack = normalize(
  add(trackVec, moodOffset('darker'))
);
const nearestDarker = search(darkerTrack, k = 10);

// Where moodOffset comes from:
// 1. Pre-compute by averaging tracks tagged "dark" vs "bright"
// 2. Or use text embedding: embed("darker") in cross-modal space
```

**Reality check**: This works *okay* for well-represented concepts, but:

- May be unpredictable for niche genres
- Better to treat as "soft nudge" than "precise navigation"
- Evaluate empirically on your music

#### Clustering

Group tracks into regions → crates as literal clusters.

```ts
// K-means clustering
import {kmeans} from 'ml-kmeans';

const trackVectors: number[][] = tracks.map(t => Array.from(t.audioVec));
const k = 20; // number of clusters
const result = kmeans(trackVectors, k, {seed: 42});

// result.clusters[i] = cluster index for track i
// result.centroids = cluster center vectors

// Each cluster becomes a "mood region" crate
const crates = new Map<number, Track[]>();
result.clusters.forEach((clusterId, trackIdx) => {
  if (!crates.has(clusterId)) crates.set(clusterId, []);
  crates.get(clusterId)!.push(tracks[trackIdx]);
});
```

**Hierarchical clustering**: Build a tree of crates (broad → specific).

#### Manifold Intuition

Embedding spaces are not truly Euclidean—they're curved manifolds embedded in Euclidean space. Practical implications:

- Local distances are meaningful; global distances less so
- "Straight line" interpolation may pass through nonsense regions
- Nearest neighbors work well; far neighbors are unreliable

**For Dekzer**: Trust k=10-50 nearest neighbors. Don't reason about "far" tracks.

---

## 2. Indexes & Databases (How to Search at Scale)

### 2.1 Approximate Nearest Neighbor (ANN) Algorithms

You probably won't implement these, but understanding them helps you choose and tune.

#### Flat (Exact Brute-Force)

- Compute distance to every vector
- O(n × d) per query
- Perfect recall, slow at scale
- **Use for**: < 10k vectors, debugging, ground truth

#### HNSW (Hierarchical Navigable Small World)

- Graph-based: each vector is a node, edges connect similar vectors
- Multi-layer hierarchy: top layers sparse (long jumps), bottom layers dense (local search)
- O(log n) search time, excellent recall (95-99%+)
- **Tradeoffs**: Higher memory (stores graph), slower inserts
- **Parameters**: `M` (edges per node), `efConstruction` (build quality), `efSearch` (query quality)
- **Use for**: High-recall requirements, moderate update frequency

```
# HNSW intuition:
Layer 3: [A] -------- [B] -------- [C]  (sparse, fast navigation)
Layer 2: [A] --- [D] --- [B] --- [E] --- [C]
Layer 1: [A]-[F]-[D]-[G]-[B]-[H]-[E]-[I]-[C]
Layer 0: [all nodes densely connected]  (local refinement)
```

#### IVF (Inverted File Index)

- Partition space into clusters (Voronoi cells)
- Query: find nearest clusters, search only those
- O(n/k × d) per query for k clusters
- **Tradeoffs**: Fast, but recall depends on `nprobe` (clusters to search)
- **Parameters**: `nlist` (number of clusters), `nprobe` (clusters to search at query time)
- **Use for**: Large scale, when memory is constrained

#### IVF-PQ (Product Quantization)

- IVF + vector compression
- Vectors split into subvectors, each quantized to codebook entry
- Massive memory savings (32x-64x)
- **Tradeoffs**: Some quality loss, but often acceptable
- **Use for**: Millions of vectors, memory-constrained

#### ScaNN (Google)

- Anisotropic vector quantization + optimized scoring
- State-of-the-art recall/speed tradeoff
- **Use for**: If you want the best and can use TensorFlow ecosystem

#### Comparison

| Algorithm | Memory    | Speed     | Recall | Updates |
|-----------|-----------|-----------|--------|---------|
| Flat      | 1x        | Slow      | 100%   | Fast    |
| HNSW      | 1.2-1.5x  | Fast      | 95-99% | Medium  |
| IVF       | 1x        | Fast      | 90-98% | Fast    |
| IVF-PQ    | 0.03-0.1x | Very fast | 85-95% | Fast    |
| ScaNN     | 0.1-0.5x  | Very fast | 95-99% | Medium  |

**Default for Dekzer:**
> Flat search for ≤10k objects; HNSW via hnswlib/usearch once we cross that. IVF/IVF-PQ only if we go multi-million
> tracks or multi-user cloud.

**For Dekzer V1**: Start with flat/brute-force (you'll have < 10k tracks). Graduate to HNSW when needed.

### 2.2 Vector DB Products & APIs

#### Embedded (In-Process)

| Product     | Language      | Algorithm   | Notes                              |
|-------------|---------------|-------------|------------------------------------|
| **hnswlib** | C++/Python/JS | HNSW        | Tiny, fast, no deps                |
| **Faiss**   | C++/Python    | All of them | Facebook's gold standard           |
| **usearch** | C++/Python/JS | HNSW        | Modern, fast, small                |
| **LanceDB** | Rust/Python   | IVF-PQ      | Embedded, columnar storage         |
| **Chroma**  | Python        | HNSW        | Developer-friendly, SQLite backend |

**For Dekzer**: `hnswlib` or `usearch` for browser/Node.js. Faiss if you need Python backend.

#### Hosted Services

| Product      | Strengths                       | Pricing Model             |
|--------------|---------------------------------|---------------------------|
| **Pinecone** | Managed, easy, fast             | Per-vector + queries      |
| **Weaviate** | GraphQL, hybrid search, modules | Self-host or cloud        |
| **Qdrant**   | Rust, fast, good filtering      | Self-host or cloud        |
| **Milvus**   | Scalable, mature                | Self-host or Zilliz cloud |
| **Vespa**    | Full search platform, hybrid    | Self-host or cloud        |
| **pgvector** | Postgres extension              | Just Postgres             |

**For Dekzer V1**: Start with embedded (hnswlib). Move to Qdrant or pgvector if you need a backend service.

#### API Shape (Conceptual)

```ts
interface VectorDB<TMetadata> {
  // Insert
  upsert(
    id: string,
    vectors: Record<string, Float32Array>,
    metadata: TMetadata,
  ): Promise<void>;

  // Search
  search(
    vectorField: string,
    query: Float32Array,
    k: number,
    filter?: FilterExpression,
  ): Promise<Array<SearchResult<TMetadata>>>;

  // Hybrid search
  hybridSearch(
    vectorField: string,
    query: Float32Array,
    textQuery: string | undefined,
    k: number,
    filter?: FilterExpression,
    weights?: { vector: number; text: number },
  ): Promise<Array<SearchResult<TMetadata>>>;

  // Delete
  delete(id: string): Promise<void>;

  deleteByFilter(filter: FilterExpression): Promise<number>;
}

interface SearchResult<TMetadata> {
  id: string;
  score: number;
  metadata: TMetadata;
}

// Example: strongly-typed track DB
type TrackMetadata = {
  readonly bpm: number;
  readonly key: string | null;
  readonly energy: number;
  readonly title: string;
  readonly artist: string;
};

type TrackVectorDB = VectorDB<TrackMetadata>;

// Filter expressions (Qdrant-style)
type FilterExpression = {
  must?: Condition[];
  should?: Condition[];
  must_not?: Condition[];
};

type Condition =
  | { field: string; match: { value: unknown } }
  | { field: string; range: { gte?: number; lte?: number } }
  | { field: string; geo_radius: { center: LatLon; radius: number } };
```

### 2.3 Hybrid Search & Scoring

Pure vector similarity gives garbage results without constraints.

#### Hard Filters (Must Match)

```ts
// "Give me tracks similar to X, but only if they fit these constraints"
const results = await db.search('audioVec', queryVec, 50, {
  must: [
    {field: 'bpm', range: {gte: 165, lte: 185}},
    {field: 'key', match: {value: ['Am', 'Em', 'Dm']}},  // compatible keys
    {field: 'hasVocals', match: {value: false}},
  ],
  must_not: [
    {field: 'playedInLast30Min', match: {value: true}},
  ]
});
```

#### Soft Scoring (Weighted Combination)

```ts
interface ScoringWeights {
  vectorSimilarity: number;  // 0.5
  bpmProximity: number;      // 0.2
  keyCompatibility: number;  // 0.15
  energyMatch: number;       // 0.1
  userPreference: number;    // 0.05
}

function computeScore(
  candidate: Track,
  query: QueryContext,
  weights: ScoringWeights
): number {
  const vecSim = dotProduct(candidate.audioVec, query.audioVec);
  const bpmDist = 1 - Math.abs(candidate.bpm - query.targetBpm) / 20;
  const keyCompat = keyCompatibilityScore(candidate.key, query.currentKey);
  const energyMatch = 1 - Math.abs(candidate.energy - query.targetEnergy);
  const userPref = query.userLikedTracks.has(candidate.id) ? 1 : 0;

  return (
    weights.vectorSimilarity * vecSim +
    weights.bpmProximity * bpmDist +
    weights.keyCompatibility * keyCompat +
    weights.energyMatch * energyMatch +
    weights.userPreference * userPref
  );
}
```

#### Candidate Generation → Re-ranking Pipeline

```
[Full corpus: 100k tracks]
        │
        ▼ Hard filter (BPM, key, rights)
[Filtered: 5k tracks]
        │
        ▼ ANN search (vector similarity, k=200)
[Candidates: 200 tracks]
        │
        ▼ Re-rank with full scoring model
[Top results: 20 tracks]
        │
        ▼ Business rules (no repeats, diversity)
[Final suggestions: 5 tracks]
```

---

## 3. Pipelines & Operations (How It Actually Stays Alive)

### Seqlok Integration Boundary

> **Critical**: Moment/gesture embeddings consume **session logs emitted by Seqlok**, never raw audio in the real-time
> path. The only contract you rely on is `{ frameIndex, command, meta }` from `LoggedCommandEvent`. The vector world
> never
> touches the audio callback, command ring, or engine state directly.

### 3.1 Ingestion & Embedding Pipelines

#### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     INGESTION SOURCES                        │
├─────────────────┬─────────────────┬─────────────────────────┤
│  New Tracks     │  Session Logs   │  User Actions           │
│  (audio files)  │  (NDJSON)       │  (likes, skips, tags)   │
└────────┬────────┴────────┬────────┴────────┬────────────────┘
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                     FEATURE FARM                             │
├─────────────────────────────────────────────────────────────┤
│  Jobs:                                                       │
│  - AudioEmbedJob: audio → audioVec, segmentVecs             │
│  - TextEmbedJob: title + tags + notes → textVec             │
│  - MomentEmbedJob: session log → momentVecs                 │
│  - MetadataEnrichJob: BPM, key, energy analysis             │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                     VECTOR STORE                             │
├─────────────────────────────────────────────────────────────┤
│  Tracks collection:  { id, audioVec, textVec, metadata }    │
│  Segments collection: { trackId, segmentType, vec }         │
│  Moments collection: { sessionId, frameIdx, vec, outcome }  │
└─────────────────────────────────────────────────────────────┘
```

#### Job Definitions

```ts
interface EmbedJob<TInput, TOutput> {
  readonly jobId: string;
  readonly priority: 'high' | 'normal' | 'low';
  readonly input: TInput;
  readonly status: 'pending' | 'running' | 'complete' | 'failed';
  readonly output?: TOutput;
  readonly error?: string;
}

// Track embedding job
interface AudioEmbedJobInput {
  trackId: string;
  audioPath: string;
  segmentBoundaries?: SegmentBoundary[];  // optional pre-computed
}

interface AudioEmbedJobOutput {
  trackId: string;
  audioVec: Float32Array;
  segmentVecs: {
    type: 'intro' | 'build' | 'drop' | 'breakdown' | 'outro';
    startFrame: number;
    endFrame: number;
    vec: Float32Array;
  }[];
  metadata: {
    bpm: number;
    key: string | null;
    energy: number;
    durationSeconds: number;
  };
}
```

#### Scheduling Strategies

| Strategy            | When                    | Example                                |
|---------------------|-------------------------|----------------------------------------|
| **Batch (offline)** | Nightly, scheduled      | Re-embed entire library with new model |
| **Nearline**        | On upload, post-session | Process new track within minutes       |
| **On-demand**       | User action triggers    | "Analyze this track now" button        |

**For Dekzer V1**: Nearline on track import, batch for model upgrades.

### 3.2 Index Lifecycle & Versioning

#### The Model Upgrade Problem

When you switch embedding models, old vectors are incompatible with new ones.

> ⚠️ **DANGER ZONE**: Do not mix vectors from different model versions in the same index unless you *really* know what
> you're doing. Distances become meaningless. Either re-embed everything, or run parallel indices during migration.

**Strategies:**

1. **Full re-embed + re-index**

- Simple, correct
- Expensive for large libraries
- Downtime during migration

2. **Parallel indices**

- Run old and new side by side
- Gradual migration
- More complex, more storage

3. **Version tagging**
   ```ts
   interface EmbeddedTrack {
     trackId: string;
     audioVec: Float32Array;
     embeddingModel: string;      // 'clap-v1', 'mert-v2', etc.
     embeddingVersion: string;    // '2024-01-15'
     embeddedAt: string;          // ISO timestamp
   }
   ```
   Filter by version at query time.

**Recommendation**: Start with version tagging + full re-embed on upgrade. Parallel indices are overkill for V1.

### 3.3 Online Behavior: Latency, Caching, Warm Paths

#### Latency Budgets

| Operation                             | Budget  | Strategy             |
|---------------------------------------|---------|----------------------|
| "Next track" suggestion (blocking UI) | < 50ms  | Pre-cached, local    |
| "Tracks like this" search             | < 200ms | Vector DB query      |
| "Ghost DJ planning" (async)           | < 5s    | Can hit external API |
| "Full library re-analysis"            | Hours   | Batch job            |

#### Caching Strategy

```ts
// Cache neighbors for frequently accessed tracks
interface NeighborCache {
  // trackId → { neighbors, computedAt, expiresAt }
  get(trackId: string): CachedNeighbors | null;

  set(trackId: string, neighbors: CachedNeighbors): void;

  invalidate(trackId: string): void;

  warmUp(trackIds: string[]): Promise<void>;  // pre-compute
}

interface CachedNeighbors {
  trackId: string;
  neighbors: { trackId: string; score: number }[];
  constraints: { bpmRange: [number, number]; keys: string[] };
  computedAt: string;
  expiresAt: string;
}
```

#### Warm Paths

Pre-compute suggestions for:

- Currently loaded tracks
- Tracks in active crates
- Tracks played in recent sessions

```ts
// On session start
async function warmUpSuggestions(deckA: Track | null, deckB: Track | null, crate: Track[]) {
  const toWarm = [deckA, deckB, ...crate.slice(0, 20)].filter(Boolean);
  await neighborCache.warmUp(toWarm.map(t => t.trackId));
}
```

### 3.4 Governance, Privacy, and Retention

#### Data Categories

| Data                  | Sensitivity | Retention       |
|-----------------------|-------------|-----------------|
| Track metadata        | Low         | Indefinite      |
| Track embeddings      | Low         | Until re-embed  |
| Session logs          | Medium      | User-controlled |
| Moment embeddings     | Medium      | User-controlled |
| User preference model | High        | User-controlled |

#### Privacy Model

```ts
interface UserDataPolicy {
  // What's stored
  sessionLogging: 'local' | 'cloud' | 'disabled';
  momentEmbeddings: 'local' | 'cloud' | 'disabled';
  preferenceModel: 'local' | 'cloud' | 'disabled';

  // Training consent
  allowAnonymizedAggregation: boolean;  // "help improve Ghost DJ"
  allowPersonalizedModel: boolean;       // "Ghost learns your style"

  // Data rights
  exportMyData(): Promise<DataExport>;

  deleteMyData(): Promise<void>;
}
```

#### Consent UI (Example)

```
┌─────────────────────────────────────────────────────────────┐
│ Ghost DJ Data Settings                                       │
├─────────────────────────────────────────────────────────────┤
│ ○ Local only (your data stays on your device)               │
│ ● Cloud sync (access your data anywhere, encrypted)         │
│ ○ Disabled (no session logging)                             │
├─────────────────────────────────────────────────────────────┤
│ □ Help improve Ghost DJ with anonymized aggregate data      │
│ ☑ Train Ghost DJ on my style (personal model)               │
├─────────────────────────────────────────────────────────────┤
│ [Export My Data]  [Delete All My Data]                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Dekzer-Specific Product Domains (Where It Gets Fun)

### Core Embedding Entities (Summary)

Before diving deep, here's the map of what gets embedded:

| Entity           | Purpose                                                          | Phase          |
|------------------|------------------------------------------------------------------|----------------|
| `TrackVectors`   | Library-level similarity, crate building, "tracks like this"     | **[CORE V1]**  |
| `SegmentVectors` | Transition-level similarity, "intros that match this outro"      | **[CORE V2]**  |
| `MomentVectors`  | Performance state / Ghost DJ memory, "have I been here before?"  | **[CORE V2]**  |
| `StemVectors`    | Per-stem similarity (drums, bass, vocals) for mashup suggestions | **[OPTIONAL]** |
| `GestureVectors` | Macros / parameter sweeps, NL → gesture search                   | **[OPTIONAL]** |

The sections below refine each of these.

### 4.1 Track / Segment / Stem Space

#### Track-Level Embeddings **[CORE V1]**

The basic unit. Every track gets:

```ts
interface TrackVectors {
  trackId: string;

  // Primary embeddings
  audioVec: Float32Array;       // full-track audio embedding
  textVec: Float32Array;        // title + artist + tags + notes

  // Optional enrichments
  rhythmVec?: Float32Array;     // beat/groove signature
  timbreVec?: Float32Array;     // tonal character

  // Metadata (not vectors, but used in hybrid search)
  bpm: number;
  key: string | null;
  energy: number;               // 0-1, computed from audio
  danceability: number;         // 0-1
  valence: number;              // 0-1, "happiness"
}
```

**Use cases:**

- "Find tracks similar to this one"
- "Build a crate around this vibe"
- Global library organization

#### Segment-Level Embeddings **[CORE V2]**

Finer grain: intro, build, drop, breakdown, outro.

```ts
interface SegmentVectors {
  trackId: string;
  segmentType: 'intro' | 'build' | 'drop' | 'breakdown' | 'outro';
  startFrame: number;
  endFrame: number;
  vec: Float32Array;

  // Segment-specific metadata
  energy: number;
  hasVocals: boolean;
  dominantInstruments: string[];
}
```

**Use cases:**

- "Find intros that match this outro" (transition planning)
- "Find drops with similar energy to this one"
- Ghost DJ phrase-level planning

**Why this matters for DJ:**
Track-level similarity misses a lot. Two tracks might have similar overall vibe but completely different intros.
Segment-level lets you match "intro to outro" which is what transitions actually need.

#### Stem-Level Embeddings **[OPTIONAL]**

Per-stem vectors (after separation):

```ts
interface StemVectors {
  trackId: string;
  stemType: 'drums' | 'bass' | 'vocals' | 'other';
  vec: Float32Array;
}
```

**Use cases:**

- "Find tracks with similar drum patterns"
- "Find tracks with vocals that would layer well"
- Mashup/remix suggestions

**For V1**: Skip stems. Add when stem separation is integrated.

### 4.2 Moment Space (State of the Set) **[CORE V2]**

A "moment" is a snapshot of the entire performance state at a point in time.

> ⚠️ **DANGER ZONE**: Only build this after you have real sessions + users. It's tempting to prototype moment embeddings
> before shipping the boring-but-useful track similarity. Don't. Ship TrackVectors first, prove they help, then come
> back
> here.

#### Moment Vector Definition

```ts
interface MomentSnapshot {
  // Temporal (frameIndex is canonical, others derived)
  readonly sessionId: string;
  readonly frameIndex: number;              // canonical: frames since session start
  readonly tSeconds: number;                // derived: frameIndex / sessionSampleRate
  readonly elapsedMinutes: number;          // derived: tSeconds / 60

  // Deck state
  readonly deckA: {
    readonly trackId: string | null;
    readonly segmentType: SegmentType;
    readonly energy: number;
    readonly beatInBar: number;
  };
  readonly deckB: {
    readonly trackId: string | null;
    readonly segmentType: SegmentType;
    readonly energy: number;
    readonly beatInBar: number;
  };

  // Mixer state
  readonly crossfader: number;              // -1 to +1
  readonly transitionPhase: 'none' | 'early' | 'mid' | 'late';

  // Audio descriptors (computed from output)
  readonly loudness: number;
  readonly spectralCentroid: number;
  readonly density: number;                 // "busyness"

  // Optional: crowd proxy
  readonly crowdEnergy?: number;            // from external signal
}
```

#### Moment Embedding (Richer — candidate for V2+)

Convert snapshot to vector:

```ts
function momentToVector(m: MomentSnapshot, trackVecs: Map<string, TrackVectors>): Float32Array {
  const parts: number[] = [];

  // Temporal features (normalized)
  parts.push(m.elapsedMinutes / 120);  // assume max 2hr set

  // Deck A contribution (weighted by crossfader)
  const deckAWeight = Math.max(0, -m.crossfader + 1) / 2;
  if (m.deckA.trackId) {
    const trackVec = trackVecs.get(m.deckA.trackId)?.audioVec;
    if (trackVec) {
      for (let i = 0; i < 64; i++) {  // truncated
        parts.push(trackVec[i] * deckAWeight);
      }
    }
  }

  // Deck B contribution
  const deckBWeight = Math.max(0, m.crossfader + 1) / 2;
  if (m.deckB.trackId) {
    const trackVec = trackVecs.get(m.deckB.trackId)?.audioVec;
    if (trackVec) {
      for (let i = 0; i < 64; i++) {
        parts.push(trackVec[i] * deckBWeight);
      }
    }
  }

  // Mixer/audio state
  parts.push(m.crossfader);
  parts.push(m.loudness);
  parts.push(m.spectralCentroid);
  parts.push(m.density);

  return normalize(new Float32Array(parts));
}
```

#### Moment Use Cases

1. **"Have I been here before?"**
   ```ts
   const currentMoment = captureCurrentMoment();
   const currentVec = momentToVector(currentMoment, trackVecs);
   const similarPastMoments = await momentIndex.search(currentVec, k=10, {
     must_not: [{ field: 'sessionId', match: { value: currentSessionId } }]
   });
   // "Last time you were in a moment like this, you did X and it worked"
   ```

2. **"Replay peak moments with different tracks"**
   ```ts
   const peakMoments = await momentIndex.search(
     queryVec,
     k=20,
     { must: [{ field: 'crowdEnergy', range: { gte: 0.8 } }] }
   );
   // Analyze what made them peak, suggest similar arcs
   ```

3. **Ghost DJ long-horizon planning**

- Retrieve past successful set arcs
- Use as templates: "you tend to peak around minute 45 with a structure like X"

#### Simple Moment Embedding (Toy — for first Ghost DJ experiments)

For V1, moment embedding can be brutally simple:

```ts
interface SimpleMoment {
  readonly trackIdA: string | null;
  readonly trackIdB: string | null;
  readonly segmentTypeA: number;  // 0-4
  readonly segmentTypeB: number;
  readonly elapsedMinutes: number;
  readonly energyEstimate: number;
}
```

Just enough to ask "what did I do in similar situations?"

### 4.3 Macro / Gesture Space **[OPTIONAL — Ghost DJ v1.x+]**

Encode DJ gestures (FX sweeps, filter rides, crossfader curves) as vectors.

> ⚠️ **DANGER ZONE**: This is the most speculative part of the doc. Do not build gesture embeddings until:
> 1. TrackVectors are shipping and useful
> 2. Moment embeddings are proven valuable
> 3. You have a real gesture library with actual usage data
>
> First version of gestures = symbolic library only (no embeddings), just search by name/tags. Embeddings come once we
> have real-world usage proving the value.

#### Macro Representation

```ts
interface MacroGesture {
  macroId: string;
  name: string;
  description: string;

  // The actual gesture (executable)
  commands: ScheduledCommand[];
  durationBars: number;

  // For embedding
  parameterCurves: {
    paramName: string;
    values: number[];      // sampled at fixed intervals
    curveType: 'linear' | 'exponential' | 's-curve';
  }[];

  // Metadata
  context: {
    typicalBpmRange: [number, number];
    typicalEnergyLevel: 'low' | 'mid' | 'high';
    transitionType: 'blend' | 'cut' | 'echo' | 'filter';
  };
}
```

#### Gesture Embedding

```ts
function gestureToVector(g: MacroGesture): Float32Array {
  const parts: number[] = [];

  // Duration (normalized)
  parts.push(g.durationBars / 32);  // assume max 32 bars

  // Parameter curve summary statistics
  for (const curve of g.parameterCurves) {
    const values = curve.values;
    parts.push(mean(values));
    parts.push(stddev(values));
    parts.push(values[values.length - 1] - values[0]);  // delta
    parts.push(curveTypeToNumber(curve.curveType));
  }

  // Text embedding of description
  const textVec = embedText(g.description);
  parts.push(...Array.from(textVec.slice(0, 64)));

  return normalize(new Float32Array(parts));
}
```

#### Gesture Use Cases

1. **"Find that tension ramp from last week"**
   ```ts
   const queryVec = embedText("slow tension ramp over 16 bars");
   const similar = await gestureIndex.search(queryVec, k=10);
   ```

2. **"Apply similar gesture, scaled"**
   ```ts
   const baseGesture = await getGesture(gestureId);
   const scaledGesture = scaleGesture(baseGesture, {
     durationBars: 8,  // original was 16
     targetTracks: [trackA, trackB]
   });
   await scheduleGesture(scaledGesture);
   ```

3. **NL → Gesture compilation**

- LLM parses "do a filter sweep into the drop"
- Searches gesture library for matches
- Compiles to command script

### 4.4 Multi-Modal Crates & Mood Boards **[OPTIONAL]**

Combine multiple embedding types for crate building.

#### Cross-Modal Search

```ts
interface CrateQuery {
  // Any combination of:
  seedTracks?: string[];              // "like these tracks"
  textDescription?: string;           // "dark industrial minimal"
  moodBoard?: {                       // visual mood
    colors?: string[];                // hex colors
    imageUrls?: string[];             // reference images
  };
  constraints?: {
    bpmRange?: [number, number];
    keys?: string[];
    energyRange?: [number, number];
  };
}

async function buildCrate(query: CrateQuery, maxTracks: number): Promise<Track[]> {
  // Combine query signals into a search vector
  const queryVecs: { vec: Float32Array; weight: number }[] = [];

  if (query.seedTracks?.length) {
    const seedVec = averageVectors(
      query.seedTracks.map(id => trackVecs.get(id)?.audioVec).filter(Boolean)
    );
    queryVecs.push({vec: seedVec, weight: 0.5});
  }

  if (query.textDescription) {
    const textVec = await embedText(query.textDescription);
    queryVecs.push({vec: textVec, weight: 0.3});
  }

  if (query.moodBoard?.colors?.length) {
    const colorVec = colorsToVector(query.moodBoard.colors);
    queryVecs.push({vec: colorVec, weight: 0.2});
  }

  const combinedQuery = weightedAverageVectors(queryVecs);

  return await db.search('audioVec', combinedQuery, maxTracks, {
    must: constraintsToFilter(query.constraints)
  });
}
```

#### Visual Crate Browsing

Project tracks to 2D for visualization:

```ts
// Use UMAP or t-SNE for dimensionality reduction
import {UMAP} from 'umap-js';

const trackVectors = tracks.map(t => Array.from(t.audioVec));
const umap = new UMAP({nComponents: 2, nNeighbors: 15, minDist: 0.1});
const positions = umap.fit(trackVectors);

// positions[i] = [x, y] for track i
// Render as scatter plot, click to preview, drag to add to crate
```

### 4.5 Evaluation & Feedback Loops

How do you know the embeddings and suggestions are actually good?

#### Offline Evaluation

**Retrieval metrics:**

```ts
interface RetrievalMetrics {
  // Given a query track, are the retrieved tracks actually similar?
  precision_at_k: number;   // % of top-k that are relevant
  recall_at_k: number;      // % of all relevant that are in top-k
  ndcg: number;             // normalized discounted cumulative gain
  mrr: number;              // mean reciprocal rank
}

// You need ground truth: human-labeled "these tracks are similar"
// Or proxy: "tracks in the same playlist", "tracks by same artist"
```

**A/B testing embeddings:**

```ts
// Compare two embedding models
const modelA = 'clap-v1';
const modelB = 'mert-v2';

const testSet = getHumanLabeledSimilarityPairs();
const metricsA = evaluateRetrieval(modelA, testSet);
const metricsB = evaluateRetrieval(modelB, testSet);

// Pick the one with better metrics on your music
```

#### Online Evaluation

Track user behavior:

```ts
interface SuggestionEvent {
  readonly suggestionId: string;
  readonly sessionId: string;
  readonly frameIndex: number;              // when suggestion was made (audio timeline)
  readonly timestamp: string;               // wall-clock ISO timestamp (for analytics)
  readonly context: MomentSnapshot;
  readonly suggestedTracks: readonly string[];
  readonly outcome: 'accepted' | 'rejected' | 'ignored';
  readonly acceptedTrackId?: string;
  readonly timeToDecisionMs?: number;
}
```

Metrics:

- **Acceptance rate**: % of suggestions that get used
- **Time to decision**: Faster = better suggestions
- **Downstream success**: Did the crowd respond well?

#### Feedback Loop (V1)

```ts
// Minimal feedback: just track accepts/rejects
interface FeedbackSignal {
  queryContext: { trackId: string; segmentType: string };
  suggestedTrackId: string;
  outcome: 'accept' | 'reject';
}

// Use to re-weight scoring
function updateScoringWeights(signals: FeedbackSignal[]): ScoringWeights {
  // Simple: increase weight of factors that correlate with accepts
  // Advanced: train a small model to predict accept/reject
}
```

#### Feedback Loop (Advanced)

```ts
// Fine-tune embeddings on your preferences
interface PreferenceDataset {
  anchors: Float32Array[];     // query vectors
  positives: Float32Array[];   // accepted suggestions
  negatives: Float32Array[];   // rejected suggestions
}

// Contrastive learning: pull positives closer, push negatives away
// This personalizes the embedding space to your taste
```

#### Human Crate Sanity Checks (Low-Tech but Critical)

Hard metrics are good, but DJ-land is super subjective. Add a scheduled "crate inspection" ritual:

**Every time you change embedding model or parameters:**

1. Generate 5 "tracks like X" queries for representative tracks across your library
2. Generate 3 auto-crates with ~20 tracks each (different vibes)
3. Spend 30 minutes manually skimming/listening
4. Ask: "Would I trust this in a real set?"

Document the results. This catches issues that precision@k misses—like "technically similar but wrong energy" or "always
suggests the same 5 tracks".

---

## 5. Implementation Roadmap

### Phase 1: Brute-Force Proof of Concept **[CORE V1]**

**Goal**: Validate that embeddings help at all.

- [ ] Pick one audio embedding model (start with spectral features, optionally add CLAP)
- [ ] Embed ~100-500 tracks
- [ ] Store in simple arrays, brute-force cosine search
- [ ] Build minimal UI: "tracks like this"
- [ ] Gut-check: do the results make sense?
- [ ] Run first crate sanity check

### Phase 2: Hybrid Search + Caching **[CORE V1]**

**Goal**: Make it usable.

- [ ] Add metadata filtering (BPM, key)
- [ ] Implement scoring weights
- [ ] Add neighbor caching
- [ ] Integrate with Dekzer track browser

### Phase 3: Segment + Moment Vectors **[CORE V2]**

**Goal**: Transition-aware suggestions.

- [ ] Compute segment-level embeddings
- [ ] Implement moment snapshots in session logging
- [ ] "Find intros that match this outro" feature
- [ ] "What did I do last time in this situation?" feature (simple moment embedding first)

### Phase 4: Gesture Library + Feedback **[OPTIONAL — Ghost DJ v0.x]**

**Goal**: Ghost DJ v0.

- [ ] Define macro/gesture format (symbolic first, no embeddings)
- [ ] Build gesture library with name/tag search
- [ ] Track suggestion accept/reject
- [ ] Basic feedback → scoring weight updates
- [ ] Optional: gesture embeddings if symbolic search isn't enough

### Phase 5: Personalization + Scale **[OPTIONAL — Ghost DJ v1.x+]**

**Goal**: Ghost DJ learns your style.

- [ ] Per-user preference models
- [ ] Fine-tuned embeddings (optional)
- [ ] Move to proper vector DB if needed (HNSW)
- [ ] Multi-modal crate building
- [ ] Gesture embeddings

---

## 6. Quick Reference

### Embedding Checklist

- [ ] Audio: spectral summary + neural model (CLAP/MERT)
- [ ] Text: sentence-transformers or OpenAI
- [ ] Normalize all vectors to unit length
- [ ] Store with metadata + version tag

### Search Checklist

- [ ] Hard filters first (BPM, key, rights)
- [ ] ANN for candidate generation
- [ ] Re-rank with weighted scoring
- [ ] Cache hot paths

### Evaluation Checklist

- [ ] Offline: retrieval metrics on test set
- [ ] Online: accept/reject tracking
- [ ] Feedback loop into scoring weights
- [ ] Crate sanity check ritual on every model change

### Privacy Checklist

- [ ] Local-first by default
- [ ] Explicit consent for cloud sync
- [ ] Data export/delete functionality
- [ ] Clear about what's used for training
