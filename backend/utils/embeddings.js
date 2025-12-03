// Text chunking utility with sentence-aware chunking
export function chunkText(text, chunkSize = 800, overlap = 150) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if ((currentChunk.length + sentence.length) <= chunkSize) {
      currentChunk += sentence;
    } else {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    }
  }
  
  // Add the last chunk
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  // Create overlapping chunks if needed
  const overlappingChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      const prevChunk = chunks[i - 1];
      const current = chunks[i];
      const overlapText = prevChunk.slice(-overlap) + ' ' + current;
      overlappingChunks.push(overlapText.trim());
    }
    overlappingChunks.push(chunks[i]);
  }
  
  return overlappingChunks.slice(0, 50); // Limit to 50 chunks max
}

// Generate embeddings for text chunks
export async function generateEmbeddings(chunks) {
  const chunksWithEmbeddings = chunks.map(text => {
    const embedding = createEnhancedEmbedding(text);
    return { text, embedding };
  });
  
  return chunksWithEmbeddings;
}

// Create enhanced embedding with better semantic representation
export function createSimpleEmbedding(text, dimensions = 256) {
  // Clean and normalize text
  const cleanText = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Replace punctuation with spaces
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .trim();
  
  const words = cleanText.split(' ');
  const embedding = new Array(dimensions).fill(0);
  
  // Enhanced hashing with word frequency and position
  words.forEach((word, wordIndex) => {
    if (word.length < 2) return;
    
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash = hash & hash;
    }
    
    // Use multiple indices based on word and position
    const index1 = Math.abs(hash) % dimensions;
    const index2 = Math.abs(hash * 31) % dimensions;
    const index3 = (Math.abs(hash) + wordIndex) % dimensions;
    
    // Add weighted values
    const weight = 1 / (wordIndex + 1); // Earlier words get more weight
    embedding[index1] += weight;
    embedding[index2] += weight * 0.7;
    embedding[index3] += weight * 0.5;
  });
  
  // Normalize the embedding
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    return embedding.map(val => val / magnitude);
  }
  return embedding;
}

// Enhanced embedding for better semantic matching
function createEnhancedEmbedding(text, dimensions = 256) {
  return createSimpleEmbedding(text, dimensions);
}

// Calculate cosine similarity
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i] || 0;
    const b = vecB[i] || 0;
    dotProduct += a * b;
    magA += a * a;
    magB += b * b;
  }
  
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  
  if (magA === 0 || magB === 0) return 0;
  
  const similarity = dotProduct / (magA * magB);
  return Math.max(0, Math.min(1, similarity)); // Clamp between 0 and 1
}

// Find relevant chunks with similarity threshold
export function findRelevantChunks(queryEmbedding, chunks, topK = 5, threshold = 0.1) {
  if (!chunks || chunks.length === 0) return [];
  
  const scored = chunks.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding || [])
  }));
  
  scored.sort((a, b) => b.score - a.score);
  
  return scored
    .filter(chunk => chunk.score > threshold)
    .slice(0, topK);
}