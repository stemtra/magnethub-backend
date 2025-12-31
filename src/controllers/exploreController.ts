import type { Response, NextFunction } from 'express';
import { LeadMagnet } from '../models/LeadMagnet.js';
import { Quiz } from '../models/Quiz.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import type { AuthenticatedRequest, ApiResponse, ILeadMagnet, IQuiz } from '../types/index.js';

// ============================================
// Types
// ============================================

export type ExploreItemType = 'leadMagnet' | 'quiz';

export interface ExploreItem {
  id: string;
  itemType: ExploreItemType;
  title: string;
  slug: string;
  type?: string; // Lead magnet type or 'quiz'
  thumbnailUrl?: string;
  createdAt: Date;
  creator: {
    username: string;
    name: string;
  };
}

export interface ExploreFeedResponse {
  items: ExploreItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// ============================================
// Get Explore Feed
// ============================================

export async function getExploreFeed(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<ExploreFeedResponse>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    // Parse query parameters
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 50); // Max 50 items per page
    const typeFilter = req.query.type as string | undefined; // 'quiz', 'infographic', etc.
    const skip = (page - 1) * limit;

    logger.info('Fetching explore feed', {
      userId: req.user._id,
      page,
      limit,
      typeFilter,
    });

    // Build query for public lead magnets
    const leadMagnetQuery: any = { isPublic: true, isPublished: true };
    if (typeFilter && typeFilter !== 'quiz') {
      leadMagnetQuery.type = typeFilter;
    }

    // Build query for public quizzes
    const quizQuery: any = { isPublic: true, status: 'published' };

    // Fetch both lead magnets and quizzes in parallel
    const [leadMagnets, quizzes] = await Promise.all([
      typeFilter === 'quiz'
        ? [] // Skip lead magnets if filtering for quizzes only
        : LeadMagnet.find(leadMagnetQuery)
            .select('_id userId title slug type infographicUrl pdfUrl createdAt')
            .sort({ createdAt: -1 })
            .limit(limit * 2) // Fetch more than needed for merging
            .lean(),
      typeFilter && typeFilter !== 'quiz'
        ? [] // Skip quizzes if filtering for other types
        : Quiz.find(quizQuery)
            .select('_id userId title slug coverImageUrl createdAt')
            .sort({ createdAt: -1 })
            .limit(limit * 2) // Fetch more than needed for merging
            .lean(),
    ]);

    // Merge and sort by createdAt
    const combinedItems = [
      ...leadMagnets.map((lm) => ({ ...lm, itemType: 'leadMagnet' as const })),
      ...quizzes.map((q) => ({ ...q, itemType: 'quiz' as const })),
    ].sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Apply pagination after merging
    const paginatedItems = combinedItems.slice(skip, skip + limit);
    const total = combinedItems.length;

    // Get unique user IDs to fetch creator info
    const userIds = [...new Set(paginatedItems.map((item) => item.userId.toString()))];
    const users = await User.find({ _id: { $in: userIds } })
      .select('_id username name')
      .lean();

    // Create a map for quick lookup
    const userMap = new Map(
      users.map((u) => [
        u._id.toString(),
        { username: u.username, name: u.name },
      ])
    );

    // Transform to response format
    const items: ExploreItem[] = paginatedItems.map((item) => {
      const creator = userMap.get(item.userId.toString()) || {
        username: 'unknown',
        name: 'Unknown',
      };

      if (item.itemType === 'leadMagnet') {
        const lm = item as any;
        return {
          id: lm._id.toString(),
          itemType: 'leadMagnet',
          title: lm.title || 'Untitled Lead Magnet',
          slug: lm.slug,
          type: lm.type,
          thumbnailUrl: lm.infographicUrl || lm.pdfUrl,
          createdAt: lm.createdAt,
          creator,
        };
      } else {
        const quiz = item as any;
        return {
          id: quiz._id.toString(),
          itemType: 'quiz',
          title: quiz.title || 'Untitled Quiz',
          slug: quiz.slug,
          type: 'quiz',
          thumbnailUrl: quiz.coverImageUrl,
          createdAt: quiz.createdAt,
          creator,
        };
      }
    });

    res.json({
      success: true,
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          hasMore: skip + limit < total,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

