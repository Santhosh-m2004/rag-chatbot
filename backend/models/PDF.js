import mongoose from 'mongoose';

const pdfSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  textContent: {
    type: String,
    required: true
  },
  chunks: [{
    text: String,
    embedding: [Number]
  }],
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
pdfSchema.index({ userId: 1, uploadedAt: -1 });

export default mongoose.model('PDF', pdfSchema);