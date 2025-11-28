import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';

// ============================================
// S3/R2 Client
// ============================================

const s3Client = new S3Client({
  region: 'auto',
  endpoint: config.r2.accountId 
    ? `https://${config.r2.accountId}.r2.cloudflarestorage.com`
    : undefined,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

// ============================================
// Upload PDF
// ============================================

export async function uploadPdf(
  pdfBuffer: Buffer,
  filename?: string
): Promise<string> {
  const key = filename || `pdfs/${uuidv4()}.pdf`;

  logger.info('Uploading PDF to storage', { key, sizeKB: Math.round(pdfBuffer.length / 1024) });

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: config.r2.bucketName,
      Key: key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      CacheControl: 'public, max-age=31536000', // Cache for 1 year
    }));

    const publicUrl = `${config.r2.publicUrl}/${key}`;
    
    logger.info('PDF uploaded successfully', { key, url: publicUrl });
    
    return publicUrl;
  } catch (error) {
    logger.error('Failed to upload PDF', error);
    throw AppError.internal('Failed to upload PDF. Please try again.');
  }
}

// ============================================
// Delete PDF
// ============================================

export async function deletePdf(url: string): Promise<void> {
  try {
    // Extract key from URL
    const key = url.replace(`${config.r2.publicUrl}/`, '');
    
    logger.info('Deleting PDF from storage', { key });

    await s3Client.send(new DeleteObjectCommand({
      Bucket: config.r2.bucketName,
      Key: key,
    }));

    logger.info('PDF deleted successfully', { key });
  } catch (error) {
    logger.error('Failed to delete PDF', error);
    // Don't throw - deletion failures shouldn't break the flow
  }
}

// ============================================
// Check if storage is configured
// ============================================

export function isStorageConfigured(): boolean {
  // Check that all required values exist and aren't placeholder values
  const isPlaceholder = (val: string) => 
    !val || val.startsWith('your_') || val.includes('your-r2') || val === '';

  return (
    !isPlaceholder(config.r2.accountId) &&
    !isPlaceholder(config.r2.accessKeyId) &&
    !isPlaceholder(config.r2.secretAccessKey) &&
    !isPlaceholder(config.r2.bucketName) &&
    !isPlaceholder(config.r2.publicUrl)
  );
}

