import express from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { authMiddleware } from '../middleware/auth.js';
import PDF from '../models/PDF.js';
import { generateEmbeddings, chunkText } from '../utils/embeddings.js';
import pdfParse from 'pdf-parse';

const router = express.Router();

// Configure Cloudinary with better debugging
console.log('\n=== Cloudinary Configuration Debug ===');
console.log('CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME);
console.log('CLOUDINARY_API_KEY type:', typeof process.env.CLOUDINARY_API_KEY);
console.log('CLOUDINARY_API_KEY length:', process.env.CLOUDINARY_API_KEY?.length);
console.log('CLOUDINARY_API_KEY value:', process.env.CLOUDINARY_API_KEY);
console.log('CLOUDINARY_API_SECRET type:', typeof process.env.CLOUDINARY_API_SECRET);
console.log('======================================\n');

// Validate and configure Cloudinary
let isCloudinaryConfigured = false;
try {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  
  if (!cloudName || !apiKey || !apiSecret) {
    console.error('Missing Cloudinary environment variables');
  } else if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    console.error('CLOUDINARY_API_KEY is not a valid string');
  } else if (typeof apiSecret !== 'string' || apiSecret.trim() === '') {
    console.error('CLOUDINARY_API_SECRET is not a valid string');
  } else {
    // Configure Cloudinary
    cloudinary.config({
      cloud_name: cloudName.trim(),
      api_key: apiKey.trim(),
      api_secret: apiSecret.trim()
    });
    
    // Test the configuration
    console.log('Cloudinary configuration test:');
    console.log('- Cloud Name:', cloudName.trim());
    console.log('- API Key:', `${apiKey.trim().substring(0, 4)}...`);
    console.log('- API Secret configured:', apiSecret.trim().substring(0, 4) + '...');
    
    isCloudinaryConfigured = true;
    console.log('✅ Cloudinary configured successfully');
  }
} catch (error) {
  console.error('❌ Cloudinary configuration error:', error.message);
}

// Configure multer for memory storage
const storage = multer.memoryStorage();
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

// Upload PDF (with Cloudinary fallback)
router.post('/upload', authMiddleware, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('\n=== PDF Upload Process ===');
    console.log('File:', req.file.originalname);
    console.log('Size:', (req.file.size / 1024).toFixed(2), 'KB');
    console.log('Cloudinary configured:', isCloudinaryConfigured);

    let cloudinaryResult = null;
    
    // Try to upload to Cloudinary if configured
    if (isCloudinaryConfigured) {
      try {
        console.log('Attempting Cloudinary upload...');
        
        // Convert buffer to base64 for Cloudinary upload
        const fileBuffer = req.file.buffer;
        const base64File = fileBuffer.toString('base64');
        const dataUri = `data:application/pdf;base64,${base64File}`;
        
        console.log('Uploading as base64 data URI...');
        
        cloudinaryResult = await cloudinary.uploader.upload(dataUri, {
          resource_type: 'raw', // Use 'raw' for PDF files
          folder: 'rag-chatbot-pdfs',
          public_id: `pdf_${Date.now()}_${req.userId}`,
          format: 'pdf'
        });
        
        console.log('✅ Cloudinary upload successful:', cloudinaryResult.public_id);
        console.log('URL:', cloudinaryResult.secure_url);
        
      } catch (cloudinaryError) {
        console.error('❌ Cloudinary upload failed:', cloudinaryError.message);
        console.error('Error details:', cloudinaryError);
        // Continue with local storage
      }
    }

    // In the upload function, add better text extraction logging:

// Extract text from PDF
console.log('Extracting text from PDF...');
const pdfData = await pdfParse(req.file.buffer);
const textContent = pdfData.text;

if (!textContent || textContent.trim().length === 0) {
  console.log('❌ Text extraction failed - empty content');
  return res.status(400).json({ error: 'Could not extract text from PDF. The PDF might be scanned or image-based.' });
}

console.log('✅ Text extracted successfully');
console.log('Text length:', textContent.length, 'characters');
console.log('First 500 chars:', textContent.substring(0, 500));

// Check if text looks like actual content (not just metadata)
const wordCount = textContent.split(/\s+/).length;
console.log('Word count:', wordCount);

if (wordCount < 10) {
  console.log('⚠️ Warning: Very low word count. PDF might be scanned/image-based.');
}

    // Chunk the text
    const chunks = chunkText(textContent);
    console.log('Text chunked into:', chunks.length, 'chunks');
    
    // Generate embeddings for chunks
    const chunksWithEmbeddings = await generateEmbeddings(chunks);
    console.log('Embeddings generated');
    
    // Prepare PDF document
    const pdfDataToSave = {
      userId: req.userId,
      filename: req.file.originalname,
      originalName: req.file.originalname,
      fileSize: req.file.size,
      textContent,
      chunks: chunksWithEmbeddings
    };

    // Add Cloudinary data if uploaded successfully
    if (cloudinaryResult) {
      pdfDataToSave.cloudinaryId = cloudinaryResult.public_id;
      pdfDataToSave.cloudinaryUrl = cloudinaryResult.secure_url;
      pdfDataToSave.storageType = 'cloudinary';
    } else {
      // Fallback to local storage mode
      pdfDataToSave.cloudinaryId = `local_${Date.now()}_${req.userId}`;
      pdfDataToSave.cloudinaryUrl = `/uploads/${req.file.originalname}`;
      pdfDataToSave.storageType = 'local';
    }
    
    // Save to database
    console.log('Saving to database...');
    const pdf = new PDF(pdfDataToSave);
    await pdf.save();
    
    console.log('✅ PDF saved to database:', pdf._id);
    
    res.status(201).json({
      message: cloudinaryResult ? 
        'PDF uploaded successfully to Cloudinary' : 
        'PDF uploaded successfully (local storage)',
      pdf: {
        _id: pdf._id,
        filename: pdf.originalName,
        cloudinaryUrl: pdf.cloudinaryUrl,
        uploadedAt: pdf.uploadedAt,
        fileSize: pdf.fileSize,
        storage: pdf.storageType || 'local',
        chunkCount: pdf.chunks.length
      }
    });
    
    console.log('=== Upload Complete ===\n');
    
  } catch (err) {
    console.error('❌ Upload error:', err);
    console.error('Error stack:', err.stack);
    
    res.status(500).json({ 
      error: 'Failed to upload PDF',
      details: err.message,
      suggestion: cloudinaryResult ? 
        'PDF text extraction failed. Please try a different PDF file.' :
        'Check Cloudinary credentials in .env file or try again.'
    });
  }
});

// Get all PDFs for user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const pdfs = await PDF.find({ userId: req.userId })
      .select('_id filename originalName cloudinaryUrl uploadedAt fileSize')
      .sort({ uploadedAt: -1 });
    
    res.json({ pdfs });
  } catch (err) {
    console.error('Fetch PDFs error:', err);
    res.status(500).json({ error: 'Failed to fetch PDFs' });
  }
});

// Delete PDF
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const pdf = await PDF.findOne({ 
      _id: req.params.id, 
      userId: req.userId 
    });
    
    if (!pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }
    
    // Delete from Cloudinary if configured and not local
    if (isCloudinaryConfigured && pdf.cloudinaryId && !pdf.cloudinaryId.startsWith('local_')) {
      try {
        await cloudinary.uploader.destroy(pdf.cloudinaryId);
        console.log('Deleted from Cloudinary:', pdf.cloudinaryId);
      } catch (deleteError) {
        console.error('Failed to delete from Cloudinary:', deleteError);
      }
    }
    
    // Delete from database
    await PDF.deleteOne({ _id: pdf._id });
    
    res.json({ 
      message: 'PDF deleted successfully' 
    });
  } catch (err) {
    console.error('Delete PDF error:', err);
    res.status(500).json({ error: 'Failed to delete PDF' });
  }
});

export default router;