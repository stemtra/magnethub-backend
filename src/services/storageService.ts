import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';

// ============================================
// S3/R2 Client (only initialized if configured)
// ============================================

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client && isCloudStorageConfigured()) {
    logger.info('Initializing R2 client for storage', {
      accountId: config.r2.accountId,
      bucketName: config.r2.bucketName,
      endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    });

    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
      // Path style avoids the SDK trying to use a bucket subdomain, which
      // Cloudflare R2 does not support with our account-style endpoint.
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    });
  }
  return s3Client!;
}

function getR2PublicBaseUrl(): string | null {
  const trimmed = (config.r2.publicUrl || '').trim();

  // If a base URL is provided, make sure the bucket is part of it
  if (trimmed) {
    const withoutTrailingSlash = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
    if (withoutTrailingSlash.includes(`/${config.r2.bucketName}`)) {
      return withoutTrailingSlash;
    }
    return `${withoutTrailingSlash}/${config.r2.bucketName}`;
  }

  // Derive a sensible default using the account + bucket, which works for
  // public buckets on the standard R2 hostname.
  if (config.r2.accountId && config.r2.bucketName) {
    return `https://${config.r2.accountId}.r2.cloudflarestorage.com/${config.r2.bucketName}`;
  }

  return null;
}

function getR2ObjectKeyFromUrl(url: string): string | null {
  const publicBaseUrl = getR2PublicBaseUrl();
  const normalizedBase = publicBaseUrl ? `${publicBaseUrl}/` : null;
  const rawBase = config.r2.publicUrl ? `${config.r2.publicUrl.replace(/\/$/, '')}/` : null;

  if (normalizedBase && url.startsWith(normalizedBase)) {
    return url.slice(normalizedBase.length);
  }

  if (rawBase && url.startsWith(rawBase)) {
    return url.slice(rawBase.length);
  }

  return null;
}

// ============================================
// Check if cloud storage is configured
// ============================================

export function isCloudStorageConfigured(): boolean {
  const isPlaceholder = (val: string) =>
    !val || val.startsWith('your_') || val.includes('your-r2') || val === '';

  const hasCreds =
    !isPlaceholder(config.r2.accountId) &&
    !isPlaceholder(config.r2.accessKeyId) &&
    !isPlaceholder(config.r2.secretAccessKey) &&
    !isPlaceholder(config.r2.bucketName);

  const publicBaseUrl = getR2PublicBaseUrl();
  const isConfigured = hasCreds && !!publicBaseUrl;

  if (!isConfigured) {
    logger.error('Cloud storage is not fully configured; uploads will fail', {
      hasCredentials: hasCreds,
      hasPublicBaseUrl: !!publicBaseUrl,
      accountIdPresent: !!config.r2.accountId,
      bucketNamePresent: !!config.r2.bucketName,
      publicUrlProvided: !!config.r2.publicUrl,
    });
  } else {
    logger.info('Cloud storage configuration loaded', {
      accountId: config.r2.accountId,
      bucketName: config.r2.bucketName,
      publicBaseUrl,
    });
  }

  return isConfigured;
}

// Alias for backwards compatibility
export const isStorageConfigured = isCloudStorageConfigured;

// ============================================
// Upload PDF (Cloud only)
// ============================================

export async function uploadPdfToCloud(
  pdfBuffer: Buffer,
  filename?: string
): Promise<string> {
  if (!isCloudStorageConfigured()) {
    throw AppError.internal('Cloud storage is not configured. Cannot upload PDF.');
  }

  const key = filename || `pdfs/${uuidv4()}.pdf`;
  const publicBaseUrl = getR2PublicBaseUrl();

  if (!publicBaseUrl) {
    logger.error('Cloud storage base URL is missing even though credentials are present.');
    throw AppError.internal('Cloud storage base URL missing. Cannot upload PDF.');
  }

  logger.info('Uploading PDF to cloud storage', {
    key,
    sizeKB: Math.round(pdfBuffer.length / 1024),
    bucket: config.r2.bucketName,
    accountId: config.r2.accountId,
  });

  try {
    await getS3Client().send(new PutObjectCommand({
      Bucket: config.r2.bucketName,
      Key: key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      CacheControl: 'public, max-age=31536000',
    }));

    const publicUrl = `${publicBaseUrl}/${key}`;
    
    logger.info('PDF uploaded to cloud successfully', { key, url: publicUrl });
    
    return publicUrl;
  } catch (error) {
    logger.error('Failed to upload PDF to cloud', {
      error,
      bucket: config.r2.bucketName,
      accountId: config.r2.accountId,
      key,
    });
    throw AppError.internal('Failed to upload PDF. Please try again.');
  }
}

// ============================================
// Upload PDF (Cloud only)
// ============================================

export async function uploadPdf(
  pdfBuffer: Buffer,
  filename?: string
): Promise<string> {
  return uploadPdfToCloud(pdfBuffer, filename);
}

// ============================================
// Get Signed PDF URL (for viewing)
// ============================================

export async function getSignedPdfUrl(
  storedUrl: string,
  expiresInSeconds = 60 * 60
): Promise<string> {
  if (!isCloudStorageConfigured()) {
    logger.warn('Cloud storage not configured when requesting signed PDF URL; returning original URL.');
    return storedUrl;
  }

  const key = getR2ObjectKeyFromUrl(storedUrl);
  if (!key) {
    logger.warn('Unable to derive R2 object key from stored URL; returning original URL.', { storedUrl });
    return storedUrl;
  }

  // Derive a friendly filename for the Content-Disposition header
  const filename = key.split('/').pop() || 'lead-magnet.pdf';
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

  try {
    const signedUrl = await getSignedUrl(
      getS3Client(),
      new GetObjectCommand({
        Bucket: config.r2.bucketName,
        Key: key,
        ResponseContentDisposition: `inline; filename="${safeFilename}"`,
        ResponseContentType: 'application/pdf',
      }),
      { expiresIn: expiresInSeconds }
    );

    logger.info('Generated signed PDF URL', {
      key,
      safeFilename,
      bucket: config.r2.bucketName,
      expiresInSeconds,
    });

    return signedUrl;
  } catch (error) {
    logger.error('Failed to generate signed PDF URL; returning original URL.', {
      error,
      key,
      bucket: config.r2.bucketName,
    });
    return storedUrl;
  }
}

// ============================================
// Upload Image (for infographics, logos, etc.)
// ============================================

export async function uploadImage(
  imageBuffer: Buffer,
  mimeType: string = 'image/png',
  filename?: string
): Promise<string> {
  if (!isCloudStorageConfigured()) {
    throw AppError.internal('Cloud storage is not configured. Cannot upload image.');
  }

  // Determine file extension from mimeType
  const extension = mimeType.split('/')[1] || 'png';
  const key = filename || `infographics/${uuidv4()}.${extension}`;
  const publicBaseUrl = getR2PublicBaseUrl();

  if (!publicBaseUrl) {
    logger.error('Cloud storage base URL is missing even though credentials are present.');
    throw AppError.internal('Cloud storage base URL missing. Cannot upload image.');
  }

  logger.info('Uploading image to cloud storage', {
    key,
    sizeKB: Math.round(imageBuffer.length / 1024),
    bucket: config.r2.bucketName,
    mimeType,
  });

  try {
    await getS3Client().send(new PutObjectCommand({
      Bucket: config.r2.bucketName,
      Key: key,
      Body: imageBuffer,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000',
    }));

    const publicUrl = `${publicBaseUrl}/${key}`;
    
    logger.info('Image uploaded to cloud successfully', { key, url: publicUrl });
    
    return publicUrl;
  } catch (error) {
    logger.error('Failed to upload image to cloud', {
      error,
      bucket: config.r2.bucketName,
      accountId: config.r2.accountId,
      key,
    });
    throw AppError.internal('Failed to upload image. Please try again.');
  }
}

// ============================================
// Get Signed Image URL (for viewing)
// ============================================

export async function getSignedImageUrl(
  storedUrl: string,
  expiresInSeconds = 60 * 60 * 24 * 7 // 7 days default for images
): Promise<string> {
  if (!isCloudStorageConfigured()) {
    logger.warn('Cloud storage not configured when requesting signed image URL; returning original URL.');
    return storedUrl;
  }

  const key = getR2ObjectKeyFromUrl(storedUrl);
  if (!key) {
    logger.warn('Unable to derive R2 object key from stored URL; returning original URL.', { storedUrl });
    return storedUrl;
  }

  // Derive a friendly filename for the Content-Disposition header
  const filename = key.split('/').pop() || 'infographic.png';
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Determine content type from extension
  const extension = filename.split('.').pop()?.toLowerCase() || 'png';
  const contentTypeMap: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
  };
  const contentType = contentTypeMap[extension] || 'image/png';

  try {
    const signedUrl = await getSignedUrl(
      getS3Client(),
      new GetObjectCommand({
        Bucket: config.r2.bucketName,
        Key: key,
        ResponseContentDisposition: `inline; filename="${safeFilename}"`,
        ResponseContentType: contentType,
      }),
      { expiresIn: expiresInSeconds }
    );

    logger.info('Generated signed image URL', {
      key,
      safeFilename,
      bucket: config.r2.bucketName,
      expiresInSeconds,
    });

    return signedUrl;
  } catch (error) {
    logger.error('Failed to generate signed image URL; returning original URL.', {
      error,
      key,
      bucket: config.r2.bucketName,
    });
    return storedUrl;
  }
}

// ============================================
// Delete PDF
// ============================================

export async function deletePdf(url: string): Promise<void> {
  try {
    if (!isCloudStorageConfigured()) {
      logger.error('Cloud storage not configured; cannot delete from R2', { url });
      throw AppError.internal('Cloud storage is not configured. Cannot delete PDF.');
    }

    // Handle legacy local URLs gracefully without deleting from disk (no longer supported)
    const localPrefix = '/api/pdfs/';
    const absoluteLocalPrefix = `${config.publicUrl}${localPrefix}`;
    if (url.startsWith(localPrefix) || url.startsWith(absoluteLocalPrefix)) {
      logger.warn('Received legacy local PDF URL; local storage is disabled', { url });
      return;
    }

    // Cloud file
    const publicBaseUrl = getR2PublicBaseUrl();

    if (!publicBaseUrl) {
      logger.error('Cloud storage configured but no public base URL; cannot delete.', { url });
      throw AppError.internal('Cloud storage base URL missing. Cannot delete PDF.');
    }

    // Normalize key to be relative to the bucket regardless of whether
    // the stored URL included the bucket segment.
    const normalizedBase = `${publicBaseUrl}/`;
    const key = url.startsWith(normalizedBase)
      ? url.slice(normalizedBase.length)
      : url.replace(`${config.r2.publicUrl}/`, '');
    
    logger.info('Deleting PDF from cloud storage', { key, bucket: config.r2.bucketName });

    await getS3Client().send(new DeleteObjectCommand({
      Bucket: config.r2.bucketName,
      Key: key,
    }));

    logger.info('Cloud PDF deleted successfully', { key });
  } catch (error) {
    logger.error('Failed to delete PDF', {
      error,
      url,
      bucket: config.r2.bucketName,
      accountId: config.r2.accountId,
    });
    // Don't throw - deletion failures shouldn't break the flow
  }
}

// ============================================
// Delete Image
// ============================================

export async function deleteImage(url: string): Promise<void> {
  try {
    if (!isCloudStorageConfigured()) {
      logger.error('Cloud storage not configured; cannot delete image from R2', { url });
      throw AppError.internal('Cloud storage is not configured. Cannot delete image.');
    }

    const publicBaseUrl = getR2PublicBaseUrl();

    if (!publicBaseUrl) {
      logger.error('Cloud storage configured but no public base URL; cannot delete image.', { url });
      throw AppError.internal('Cloud storage base URL missing. Cannot delete image.');
    }

    // Extract the key from the URL
    const normalizedBase = `${publicBaseUrl}/`;
    const key = url.startsWith(normalizedBase)
      ? url.slice(normalizedBase.length)
      : url.replace(`${config.r2.publicUrl}/`, '');
    
    logger.info('Deleting image from cloud storage', { key, bucket: config.r2.bucketName });

    await getS3Client().send(new DeleteObjectCommand({
      Bucket: config.r2.bucketName,
      Key: key,
    }));

    logger.info('Cloud image deleted successfully', { key });
  } catch (error) {
    logger.error('Failed to delete image', {
      error,
      url,
      bucket: config.r2.bucketName,
      accountId: config.r2.accountId,
    });
    // Don't throw - deletion failures shouldn't break the flow
  }
}

