import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import { authMiddleware } from '../middleware/auth.js';
import PDF from '../models/PDF.js';
import { generateEmbeddings, chunkText } from '../utils/embeddings.js';

const router = express.Router();

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = './uploads';
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Upload PDF
router.post('/upload', authMiddleware, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Extract text from PDF
    const dataBuffer = await fs.readFile(req.file.path);
    const pdfData = await pdfParse(dataBuffer);
    const textContent = pdfData.text;
    
    if (!textContent || textContent.trim().length === 0) {
      await fs.unlink(req.file.path);
      return res.status(400).json({ error: 'Could not extract text from PDF' });
    }
    
    // Chunk the text
    const chunks = chunkText(textContent);
    
    // Generate embeddings for chunks (this is simplified - in production use proper vector DB)
    const chunksWithEmbeddings = await generateEmbeddings(chunks);
    
    // Save to database
    const pdf = new PDF({
      userId: req.userId,
      filename: req.file.filename,
      originalName: req.file.originalname,
      filePath: req.file.path,
      fileSize: req.file.size,
      textContent,
      chunks: chunksWithEmbeddings
    });
    
    await pdf.save();
    
    res.status(201).json({
      message: 'PDF uploaded successfully',
      pdf: {
        _id: pdf._id,
        filename: pdf.originalName,
        uploadedAt: pdf.uploadedAt
      }
    });
  } catch (err) {
    console.error('Upload error:', err);
    if (req.file) {
      await fs.unlink(req.file.path).catch(console.error);
    }
    res.status(500).json({ error: 'Failed to upload PDF' });
  }
});

// Get all PDFs for user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const pdfs = await PDF.find({ userId: req.userId })
      .select('_id filename originalName uploadedAt fileSize')
      .sort({ uploadedAt: -1 });
    
    const formattedPdfs = pdfs.map(pdf => ({
      _id: pdf._id,
      filename: pdf.originalName,
      uploadedAt: pdf.uploadedAt,
      fileSize: pdf.fileSize
    }));
    
    res.json({ pdfs: formattedPdfs });
  } catch (err) {
    console.error('Fetch PDFs error:', err);
    res.status(500).json({ error: 'Failed to fetch PDFs' });
  }
});

// Delete PDF
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const pdf = await PDF.findOne({ _id: req.params.id, userId: req.userId });
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }
    
    // Delete file from disk
    await fs.unlink(pdf.filePath).catch(console.error);
    
    // Delete from database
    await PDF.deleteOne({ _id: pdf._id });
    
    res.json({ message: 'PDF deleted successfully' });
  } catch (err) {
    console.error('Delete PDF error:', err);
    res.status(500).json({ error: 'Failed to delete PDF' });
  }
});

export default router;