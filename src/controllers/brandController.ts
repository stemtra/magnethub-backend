import type { Response, NextFunction } from 'express';
import { Brand } from '../models/Brand.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { scrapeBrand } from '../services/brandScrapingService.js';
import { normalizeInstagramUrl } from '../services/instagramService.js';
import { normalizeYouTubeUrl } from '../services/youtubeService.js';
import type { AuthenticatedRequest, ApiResponse, IBrand, IBrandSettings } from '../types/index.js';

// ============================================
// Get All Brands for User
// ============================================

export async function getAll(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ brands: IBrand[] }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const brands = await Brand.find({ userId: req.user._id })
      .sort({ isDefault: -1, createdAt: -1 }); // Default first, then newest

    res.json({
      success: true,
      data: { brands },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Single Brand
// ============================================

export async function getOne(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ brand: IBrand }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    const brand = await Brand.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!brand) {
      throw AppError.notFound('Brand not found');
    }

    res.json({
      success: true,
      data: { brand },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Create Brand
// ============================================

export async function create(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ brand: IBrand }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { name, sourceType, sourceUrl, settings, isDefault } = req.body;

    // Normalize the sourceUrl based on source type
    let normalizedSourceUrl = sourceUrl;
    if (sourceType === 'instagram') {
      normalizedSourceUrl = normalizeInstagramUrl(sourceUrl);
    } else if (sourceType === 'youtube') {
      normalizedSourceUrl = normalizeYouTubeUrl(sourceUrl);
    }
    // For websites, no normalization needed (just trimmed by Mongoose)

    // Check if brand with same source already exists
    const existingBrand = await Brand.findOne({
      userId: req.user._id,
      sourceUrl: normalizedSourceUrl,
    });

    if (existingBrand) {
      throw AppError.badRequest('A brand with this source already exists');
    }

    // If this is the first brand or isDefault is true, make it default
    const brandCount = await Brand.countDocuments({ userId: req.user._id });
    const shouldBeDefault = isDefault || brandCount === 0;

    // Scrape and analyze the brand source
    let scrapedData;
    try {
      logger.info('Scraping brand source', { sourceUrl: normalizedSourceUrl, sourceType });
      scrapedData = await scrapeBrand(normalizedSourceUrl, sourceType);
      logger.info('Brand scraping successful', {
        hasVoice: !!scrapedData.brandVoice,
        hasAudience: !!scrapedData.targetAudience,
        keyMessagesCount: scrapedData.keyMessages.length,
      });
    } catch (scrapingError) {
      // Log error but don't fail brand creation
      logger.warn('Brand scraping failed, creating brand without scraped data', {
        error: scrapingError instanceof Error ? scrapingError.message : String(scrapingError),
        sourceUrl: normalizedSourceUrl,
        sourceType,
      });
    }

    // Merge scraped settings with provided settings (provided settings take precedence)
    // If no scraped settings and no provided settings, ensure we have proper defaults
    let finalSettings: any;
    if (scrapedData?.brandSettings) {
      // Use scraped settings as base, override with any provided settings
      finalSettings = { ...scrapedData.brandSettings, ...settings };
    } else if (settings && Object.keys(settings).length > 0) {
      // Use provided settings
      finalSettings = settings;
    } else {
      // No settings available - use neutral defaults instead of MagnetHub colors
      finalSettings = {
        primaryColor: '#1F1F1F',
        accentColor: '#3B82F6', // Blue accent
        backgroundColor: '#FFFFFF',
        textColor: '#1F1F1F',
        fontFamily: 'Inter',
        theme: 'light',
      };
      logger.info('Using neutral default settings for brand', { name });
    }

    const brand = await Brand.create({
      userId: req.user._id,
      name,
      description: scrapedData?.description,
      sourceType,
      sourceUrl: normalizedSourceUrl,
      settings: finalSettings,
      isDefault: shouldBeDefault,
      brandVoice: scrapedData?.brandVoice,
      targetAudience: scrapedData?.targetAudience,
      keyMessages: scrapedData?.keyMessages,
      scrapedContent: scrapedData?.scrapedContent,
      scrapedAt: scrapedData ? new Date() : undefined,
      isScraped: !!scrapedData,
    });

    // Update logo if scraped
    if (scrapedData?.logoUrl && !settings?.logoUrl) {
      brand.settings.logoUrl = scrapedData.logoUrl;
      await brand.save();
    }

    // Mark user as having completed onboarding after creating their first brand
    if (brandCount === 0 && req.user) {
      req.user.hasCompletedOnboarding = true;
      await req.user.save();
      logger.info('User completed onboarding', { userId: req.user._id });
    }

    logger.info('Brand created', {
      userId: req.user._id,
      brandId: brand._id,
      name,
      sourceType,
      sourceUrl: normalizedSourceUrl,
      isScraped: brand.isScraped,
    });

    res.status(201).json({
      success: true,
      data: { brand },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Update Brand
// ============================================

export async function update(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ brand: IBrand }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;
    const { name, sourceUrl, settings, isDefault } = req.body;

    const brand = await Brand.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!brand) {
      throw AppError.notFound('Brand not found');
    }

    // Normalize the sourceUrl based on source type
    let normalizedSourceUrl = sourceUrl;
    if (sourceUrl !== undefined) {
      if (brand.sourceType === 'instagram') {
        normalizedSourceUrl = normalizeInstagramUrl(sourceUrl);
      } else if (brand.sourceType === 'youtube') {
        normalizedSourceUrl = normalizeYouTubeUrl(sourceUrl);
      }
      // For websites, no normalization needed (just trimmed by Mongoose)
    }

    // If sourceUrl is being updated, check for duplicates
    if (normalizedSourceUrl !== undefined && normalizedSourceUrl !== brand.sourceUrl) {
      const existingBrand = await Brand.findOne({
        userId: req.user._id,
        sourceUrl: normalizedSourceUrl,
        _id: { $ne: id }, // Exclude current brand from check
      });

      if (existingBrand) {
        throw AppError.badRequest('A brand with this source already exists');
      }
    }

    // Update fields
    if (name !== undefined) brand.name = name;
    if (normalizedSourceUrl !== undefined) brand.sourceUrl = normalizedSourceUrl;
    if (settings !== undefined) {
      brand.settings = { ...brand.settings, ...settings } as IBrandSettings;
    }
    if (isDefault !== undefined) brand.isDefault = isDefault;

    await brand.save();

    logger.info('Brand updated', {
      userId: req.user._id,
      brandId: brand._id,
      updatedFields: { 
        name: name !== undefined, 
        sourceUrl: sourceUrl !== undefined,
        normalizedSourceUrl: normalizedSourceUrl !== sourceUrl ? normalizedSourceUrl : undefined,
        settings: settings !== undefined, 
        isDefault: isDefault !== undefined 
      },
    });

    res.json({
      success: true,
      data: { brand },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Delete Brand
// ============================================

export async function remove(
  req: AuthenticatedRequest,
  res: Response<ApiResponse>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    const brand = await Brand.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!brand) {
      throw AppError.notFound('Brand not found');
    }

    const wasDefault = brand.isDefault;
    await brand.deleteOne();

    // If deleted brand was default, make the oldest remaining brand default
    if (wasDefault) {
      const nextBrand = await Brand.findOne({ userId: req.user._id })
        .sort({ createdAt: 1 });
      if (nextBrand) {
        nextBrand.isDefault = true;
        await nextBrand.save();
      }
    }

    logger.info('Brand deleted', {
      userId: req.user._id,
      brandId: id,
    });

    res.json({
      success: true,
      data: { message: 'Brand deleted successfully' },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Set Default Brand
// ============================================

export async function setDefault(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ brand: IBrand }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const { id } = req.params;

    const brand = await Brand.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!brand) {
      throw AppError.notFound('Brand not found');
    }

    brand.isDefault = true;
    await brand.save(); // Pre-save hook will unset other defaults

    logger.info('Brand set as default', {
      userId: req.user._id,
      brandId: brand._id,
    });

    res.json({
      success: true,
      data: { brand },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Find or Create Brand by Source URL
// ============================================

export async function findOrCreateBySource(
  userId: string,
  sourceType: 'website' | 'instagram',
  sourceUrl: string,
  name: string,
  settings: Partial<IBrandSettings>
): Promise<IBrand> {
  // Try to find existing brand
  let brand = await Brand.findOne({ userId, sourceUrl });

  if (!brand) {
    // Check if this is the first brand
    const brandCount = await Brand.countDocuments({ userId });
    
    brand = await Brand.create({
      userId,
      name,
      sourceType,
      sourceUrl,
      settings,
      isDefault: brandCount === 0, // First brand is default
    });

    logger.info('Brand auto-created from source', {
      userId,
      brandId: brand._id,
      name,
      sourceType,
      sourceUrl,
    });
  }

  return brand;
}

