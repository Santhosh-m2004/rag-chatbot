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
  cloudinaryId: {
    type: String,
    required: true,
    unique: true
  },
  cloudinaryUrl: {
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

// Only create indexes once - remove duplicate index definitions
pdfSchema.index({ userId: 1, uploadedAt: -1 });

export default mongoose.model('PDF', pdfSchema);