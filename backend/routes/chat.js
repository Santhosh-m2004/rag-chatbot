import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import PDF from '../models/PDF.js';
import { generateResponse , findRelevantChunks} from "../utils/groq.js";



const router = express.Router();

// Chat with PDF
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { pdfId, message } = req.body;
    
    if (!pdfId || !message) {
      return res.status(400).json({ error: 'PDF ID and message are required' });
    }
    
    // Get PDF from database
    const pdf = await PDF.findOne({ _id: pdfId, userId: req.userId });
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }
    
    // Find relevant chunks using semantic search
    const relevantChunks = await findRelevantChunks(message, pdf.chunks);
    
    // Create context from relevant chunks
    const context = relevantChunks.map(chunk => chunk.text).join('\n\n');
    
    // Generate response using Google Gemini
    const response = await generateResponse(message, context, pdf.originalName);
    
    res.json({ response });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

export default router;