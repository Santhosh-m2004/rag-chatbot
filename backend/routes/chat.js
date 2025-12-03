import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import PDF from '../models/PDF.js';
import { generateResponse } from '../utils/groq.js';
import { createSimpleEmbedding, cosineSimilarity } from '../utils/embeddings.js';

const router = express.Router();

// Chat with PDF (RAG implementation)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { message, pdfId } = req.body;
    const userId = req.userId;

    if (!message || !pdfId) {
      return res.status(400).json({ 
        error: 'Message and PDF ID are required' 
      });
    }

    console.log('\n=== RAG Chat Process ===');
    console.log('User:', userId);
    console.log('PDF ID:', pdfId);
    console.log('Question:', message);

    // Find the specific PDF for this user
    const pdf = await PDF.findOne({ 
      _id: pdfId, 
      userId: userId 
    });

    if (!pdf) {
      console.log('PDF not found for user');
      return res.status(404).json({ 
        error: 'PDF not found or access denied' 
      });
    }

    // Check if PDF has chunks
    if (!pdf.chunks || pdf.chunks.length === 0) {
      console.log('PDF has no chunks');
      return res.status(400).json({ 
        error: 'PDF has no processed content. Please re-upload.' 
      });
    }

    console.log(`PDF "${pdf.filename}" loaded with ${pdf.chunks.length} chunks`);

    // Create query embedding
    const queryEmbedding = createSimpleEmbedding(message);
    console.log('Query embedding created');

    // Find relevant chunks using cosine similarity
    const chunksWithScores = pdf.chunks.map((chunk, index) => {
      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding || []);
      return {
        index,
        text: chunk.text,
        score: similarity
      };
    });

    // Sort by relevance and get top chunks
    chunksWithScores.sort((a, b) => b.score - a.score);
    
    console.log('\nTop chunk scores:');
    chunksWithScores.slice(0, 5).forEach((chunk, i) => {
      console.log(`[${i}] Score: ${chunk.score.toFixed(4)} - ${chunk.text.substring(0, 100)}...`);
    });

    const relevantChunks = chunksWithScores
      .filter(chunk => chunk.score > 0.1) // Lower threshold to get more context
      .slice(0, 5);

    console.log(`Found ${relevantChunks.length} relevant chunks (score > 0.1)`);

    // If no relevant chunks found, use general response
    if (relevantChunks.length === 0) {
      console.log('No relevant chunks found, using general knowledge');
      const prompt = `Question: ${message}\n\nAnswer based on general knowledge:`;
      const response = await generateResponse(prompt);
      return res.json({
        response,
        source: 'general_knowledge',
        relevantChunks: [],
        debug: { chunkCount: pdf.chunks.length, maxScore: chunksWithScores[0]?.score || 0 }
      });
    }

    // Create context from relevant chunks
    const context = relevantChunks.map(chunk => chunk.text).join('\n\n');
    console.log(`Context length: ${context.length} characters`);

    // Create RAG prompt with clear instructions
    const ragPrompt = `You are an AI assistant answering questions based ONLY on the provided document context.
    
    DOCUMENT CONTEXT:
    ${context}
    
    QUESTION: ${message}
    
    IMPORTANT INSTRUCTIONS:
    1. Answer STRICTLY based on the document context above.
    2. If the context doesn't contain enough information to answer, say: "I cannot answer this question based on the provided document."
    3. Do not use any external knowledge or make assumptions.
    4. If the question is not related to the document content, say: "This question is not covered in the document."
    5. Keep your answer concise and directly based on the context.
    
    ANSWER:`;

    console.log('\nSending to Groq with RAG context...');
    
    // Generate response using Groq
    const response = await generateResponse(ragPrompt);

    console.log('✅ Response generated successfully');
    console.log('Response length:', response.length, 'characters');

    res.json({
      response,
      source: 'pdf_content',
      relevantChunks: relevantChunks.map((chunk, index) => ({
        id: index,
        text: chunk.text.substring(0, 150) + '...',
        score: chunk.score
      })),
      debug: {
        chunkCount: pdf.chunks.length,
        relevantChunksFound: relevantChunks.length,
        topScore: relevantChunks[0]?.score || 0,
        contextLength: context.length
      }
    });

  } catch (error) {
    console.error('❌ Chat error:', error);
    console.error('Error stack:', error.stack);
    
    // Fallback to direct response if RAG fails
    try {
      console.log('Attempting fallback to direct response...');
      const directResponse = await generateResponse(req.body.message);
      return res.json({
        response: directResponse,
        source: 'direct_fallback',
        relevantChunks: [],
        error: 'RAG failed, using direct response'
      });
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      res.status(500).json({ 
        error: 'Failed to process request',
        details: error.message,
        suggestion: 'Check if the PDF has been properly processed with embeddings'
      });
    }
  }
});

// Get chat history for a PDF
router.get('/history/:pdfId', authMiddleware, async (req, res) => {
  try {
    const pdf = await PDF.findOne({
      _id: req.params.pdfId,
      userId: req.userId
    }).select('_id filename');

    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    res.json({
      pdfId: pdf._id,
      pdfName: pdf.filename,
      messages: []
    });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

export default router;