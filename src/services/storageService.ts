import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';

// ============================================
// Local Storage Directory
// ============================================

const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'uploads', 'pdfs');

// Ensure local storage directory exists
async function ensureLocalStorageDir(): Promise<void> {
  try {
    await fs.mkdir(LOCAL_STORAGE_DIR, { recursive: true });
  } catch (error) {
    logger.error('Failed to create local storage directory', error);
  }
}

// Initialize local storage on module load
ensureLocalStorageDir();

// ============================================
// S3/R2 Client (only initialized if configured)
// ============================================

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client && isCloudStorageConfigured()) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    });
  }
  return s3Client!;
}

// ============================================
// Check if cloud storage is configured
// ============================================

export function isCloudStorageConfigured(): boolean {
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

// Alias for backwards compatibility
export const isStorageConfigured = isCloudStorageConfigured;

// ============================================
// Upload PDF (Cloud)
// ============================================

export async function uploadPdfToCloud(
  pdfBuffer: Buffer,
  filename?: string
): Promise<string> {
  const key = filename || `pdfs/${uuidv4()}.pdf`;

  logger.info('Uploading PDF to cloud storage', { key, sizeKB: Math.round(pdfBuffer.length / 1024) });

  try {
    await getS3Client().send(new PutObjectCommand({
      Bucket: config.r2.bucketName,
      Key: key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      CacheControl: 'public, max-age=31536000',
    }));

    const publicUrl = `${config.r2.publicUrl}/${key}`;
    
    logger.info('PDF uploaded to cloud successfully', { key, url: publicUrl });
    
    return publicUrl;
  } catch (error) {
    logger.error('Failed to upload PDF to cloud', error);
    throw AppError.internal('Failed to upload PDF. Please try again.');
  }
}

// ============================================
// Upload PDF (Local Filesystem)
// ============================================

export async function uploadPdfLocal(
  pdfBuffer: Buffer,
  filename?: string
): Promise<string> {
  await ensureLocalStorageDir();
  
  const uniqueFilename = filename || `${uuidv4()}.pdf`;
  // Flatten the path - replace slashes with dashes
  const safeFilename = uniqueFilename.replace(/\//g, '-');
  const filePath = path.join(LOCAL_STORAGE_DIR, safeFilename);

  logger.info('Saving PDF to local storage', { 
    filename: safeFilename, 
    sizeKB: Math.round(pdfBuffer.length / 1024) 
  });

  try {
    await fs.writeFile(filePath, pdfBuffer);
    
    // Return an absolute URL that our API will serve
    const localUrl = `${config.publicUrl}/api/pdfs/${safeFilename}`;
    
    logger.info('PDF saved locally', { filename: safeFilename, url: localUrl });
    
    return localUrl;
  } catch (error) {
    logger.error('Failed to save PDF locally', error);
    throw AppError.internal('Failed to save PDF. Please try again.');
  }
}

// ============================================
// Upload PDF (Auto-select storage)
// ============================================

export async function uploadPdf(
  pdfBuffer: Buffer,
  filename?: string
): Promise<string> {
  if (isCloudStorageConfigured()) {
    return uploadPdfToCloud(pdfBuffer, filename);
  } else {
    return uploadPdfLocal(pdfBuffer, filename);
  }
}

// ============================================
// Get Local PDF Path
// ============================================

export async function getLocalPdfPath(filename: string): Promise<string | null> {
  const filePath = path.join(LOCAL_STORAGE_DIR, filename);
  
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    return null;
  }
}

// ============================================
// Delete PDF
// ============================================

export async function deletePdf(url: string): Promise<void> {
  try {
    if (url.startsWith('/api/pdfs/')) {
      // Local file
      const filename = url.replace('/api/pdfs/', '');
      const filePath = path.join(LOCAL_STORAGE_DIR, filename);
      await fs.unlink(filePath);
      logger.info('Local PDF deleted', { filename });
    } else if (isCloudStorageConfigured()) {
      // Cloud file
      const key = url.replace(`${config.r2.publicUrl}/`, '');
      
      logger.info('Deleting PDF from cloud storage', { key });

      await getS3Client().send(new DeleteObjectCommand({
        Bucket: config.r2.bucketName,
        Key: key,
      }));

      logger.info('Cloud PDF deleted successfully', { key });
    }
  } catch (error) {
    logger.error('Failed to delete PDF', error);
    // Don't throw - deletion failures shouldn't break the flow
  }
}

