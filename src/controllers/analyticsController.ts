import type { Response, NextFunction } from 'express';
import { LeadMagnet } from '../models/LeadMagnet.js';
import { Lead } from '../models/Lead.js';
import { PageView } from '../models/PageView.js';
import { Quiz } from '../models/Quiz.js';
import { QuizResponse } from '../models/QuizResponse.js';
import { AppError } from '../utils/AppError.js';
import type { AuthenticatedRequest, ApiResponse } from '../types/index.js';

// ============================================
// Types
// ============================================

interface OverviewStats {
  totalViews: number;
  totalLeads: number;
  conversionRate: number;
  viewsToday: number;
  leadsToday: number;
  viewsThisWeek: number;
  leadsThisWeek: number;
  avgLeadsPerDay: number;
}

interface TimeSeriesPoint {
  date: string;
  views: number;
  leads: number;
}

interface SourceBreakdown {
  source: string;
  views: number;
  leads: number;
  conversionRate: number;
}

interface FunnelPerformance {
  id: string;
  title: string;
  slug: string;
  type: string;
  views: number;
  leads: number;
  conversionRate: number;
}

interface RecentActivity {
  type: 'view' | 'lead';
  source: string;
  leadMagnetTitle: string;
  email?: string;
  createdAt: Date;
}

// ============================================
// Helper Functions
// ============================================

function getStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDaysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ============================================
// Get Overview Stats
// ============================================

export async function getOverview(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ stats: OverviewStats }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    // Get all user's lead magnets
    const leadMagnets = await LeadMagnet.find({ userId: req.user._id }).select('_id');
    const leadMagnetIds = leadMagnets.map((lm) => lm._id);

    // Get all user's quizzes
    const quizzes = await Quiz.find({ userId: req.user._id }).select('_id stats');
    const quizIds = quizzes.map((q) => q._id);

    if (leadMagnetIds.length === 0 && quizIds.length === 0) {
      res.json({
        success: true,
        data: {
          stats: {
            totalViews: 0,
            totalLeads: 0,
            conversionRate: 0,
            viewsToday: 0,
            leadsToday: 0,
            viewsThisWeek: 0,
            leadsThisWeek: 0,
            avgLeadsPerDay: 0,
          },
        },
      });
      return;
    }

    const today = getStartOfDay(new Date());
    const weekStart = getStartOfWeek(new Date());
    const thirtyDaysAgo = getDaysAgo(30);

    // Parallel queries for efficiency
    const [
      totalViews,
      totalLeads,
      viewsToday,
      leadsToday,
      viewsThisWeek,
      leadsThisWeek,
      leadsLast30Days,
      // Quiz-specific queries
      quizViewsToday,
      quizViewsWeek,
      quizEmailCapturesToday,
      quizEmailCapturesWeek,
      quizEmailCapturesLast30Days,
    ] = await Promise.all([
      PageView.countDocuments({ leadMagnetId: { $in: leadMagnetIds } }),
      Lead.countDocuments({ leadMagnetId: { $in: leadMagnetIds } }),
      PageView.countDocuments({
        leadMagnetId: { $in: leadMagnetIds },
        createdAt: { $gte: today },
      }),
      Lead.countDocuments({
        leadMagnetId: { $in: leadMagnetIds },
        createdAt: { $gte: today },
      }),
      PageView.countDocuments({
        leadMagnetId: { $in: leadMagnetIds },
        createdAt: { $gte: weekStart },
      }),
      Lead.countDocuments({
        leadMagnetId: { $in: leadMagnetIds },
        createdAt: { $gte: weekStart },
      }),
      Lead.countDocuments({
        leadMagnetId: { $in: leadMagnetIds },
        createdAt: { $gte: thirtyDaysAgo },
      }),
      // Quiz views (starts)
      QuizResponse.countDocuments({
        quizId: { $in: quizIds },
        startedAt: { $exists: true },
        createdAt: { $gte: today },
      }),
      QuizResponse.countDocuments({
        quizId: { $in: quizIds },
        startedAt: { $exists: true },
        createdAt: { $gte: weekStart },
      }),
      // Quiz email captures (use emailCapturedAt if available, fallback to completedAt or createdAt)
      QuizResponse.countDocuments({
        quizId: { $in: quizIds },
        email: { $exists: true, $ne: '' },
        $or: [
          { emailCapturedAt: { $gte: today } },
          { emailCapturedAt: { $exists: false }, completedAt: { $gte: today } },
          { emailCapturedAt: { $exists: false }, completedAt: { $exists: false }, createdAt: { $gte: today } },
        ],
      }),
      QuizResponse.countDocuments({
        quizId: { $in: quizIds },
        email: { $exists: true, $ne: '' },
        $or: [
          { emailCapturedAt: { $gte: weekStart } },
          { emailCapturedAt: { $exists: false }, completedAt: { $gte: weekStart } },
          { emailCapturedAt: { $exists: false }, completedAt: { $exists: false }, createdAt: { $gte: weekStart } },
        ],
      }),
      QuizResponse.countDocuments({
        quizId: { $in: quizIds },
        email: { $exists: true, $ne: '' },
        $or: [
          { emailCapturedAt: { $gte: thirtyDaysAgo } },
          { emailCapturedAt: { $exists: false }, completedAt: { $gte: thirtyDaysAgo } },
          { emailCapturedAt: { $exists: false }, completedAt: { $exists: false }, createdAt: { $gte: thirtyDaysAgo } },
        ],
      }),
    ]);

    // Aggregate quiz views from quiz stats
    const quizTotalViews = quizzes.reduce((sum, quiz) => sum + (quiz.stats?.views || 0), 0);
    const quizTotalEmailCaptures = quizzes.reduce((sum, quiz) => sum + (quiz.stats?.emailsCaptured || 0), 0);

    // Combine lead magnet and quiz metrics
    const combinedTotalViews = totalViews + quizTotalViews;
    const combinedTotalLeads = totalLeads + quizTotalEmailCaptures;
    const combinedViewsToday = viewsToday + quizViewsToday;
    const combinedLeadsToday = leadsToday + quizEmailCapturesToday;
    const combinedViewsThisWeek = viewsThisWeek + quizViewsWeek;
    const combinedLeadsThisWeek = leadsThisWeek + quizEmailCapturesWeek;
    const combinedLeadsLast30Days = leadsLast30Days + quizEmailCapturesLast30Days;

    const conversionRate = combinedTotalViews > 0 ? (combinedTotalLeads / combinedTotalViews) * 100 : 0;
    const avgLeadsPerDay = combinedLeadsLast30Days / 30;

    res.json({
      success: true,
      data: {
        stats: {
          totalViews: combinedTotalViews,
          totalLeads: combinedTotalLeads,
          conversionRate: Math.round(conversionRate * 100) / 100,
          viewsToday: combinedViewsToday,
          leadsToday: combinedLeadsToday,
          viewsThisWeek: combinedViewsThisWeek,
          leadsThisWeek: combinedLeadsThisWeek,
          avgLeadsPerDay: Math.round(avgLeadsPerDay * 100) / 100,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Time Series Data
// ============================================

export async function getTimeSeries(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ timeSeries: TimeSeriesPoint[] }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const days = parseInt(req.query.days as string) || 30;
    const timezone = (req.query.timezone as string) || 'UTC';
    const startDate = getDaysAgo(days);

    const leadMagnets = await LeadMagnet.find({ userId: req.user._id }).select('_id');
    const leadMagnetIds = leadMagnets.map((lm) => lm._id);

    const quizzes = await Quiz.find({ userId: req.user._id }).select('_id');
    const quizIds = quizzes.map((q) => q._id);

    if (leadMagnetIds.length === 0 && quizIds.length === 0) {
      res.json({ success: true, data: { timeSeries: [] } });
      return;
    }

    // Aggregate views by day (lead magnets) - use user's timezone
    const viewsAgg = await PageView.aggregate([
      {
        $match: {
          leadMagnetId: { $in: leadMagnetIds },
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Aggregate leads by day (lead magnets) - use user's timezone
    const leadsAgg = await Lead.aggregate([
      {
        $match: {
          leadMagnetId: { $in: leadMagnetIds },
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Aggregate quiz views by day (quiz starts/responses) - use user's timezone
    const quizViewsAgg = await QuizResponse.aggregate([
      {
        $match: {
          quizId: { $in: quizIds },
          startedAt: { $exists: true },
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Aggregate quiz email captures by day (use emailCapturedAt, fallback to completedAt or createdAt)
    // Use user's timezone for accurate date grouping
    const quizLeadsAgg = await QuizResponse.aggregate([
      {
        $match: {
          quizId: { $in: quizIds },
          email: { $exists: true, $ne: '' },
        },
      },
      {
        $addFields: {
          effectiveEmailDate: {
            $ifNull: [
              '$emailCapturedAt',
              { $ifNull: ['$completedAt', '$createdAt'] }
            ]
          }
        }
      },
      {
        $match: {
          effectiveEmailDate: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$effectiveEmailDate', timezone },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Create maps for quick lookup
    const viewsMap = new Map(viewsAgg.map((v) => [v._id, v.count]));
    const leadsMap = new Map(leadsAgg.map((l) => [l._id, l.count]));
    const quizViewsMap = new Map(quizViewsAgg.map((v) => [v._id, v.count]));
    const quizLeadsMap = new Map(quizLeadsAgg.map((l) => [l._id, l.count]));

    // Generate complete time series with all days
    const timeSeries: TimeSeriesPoint[] = [];
    const current = new Date(startDate);
    const end = new Date();
    // Set end to end of today in UTC to ensure we include today's data
    end.setUTCHours(23, 59, 59, 999);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      timeSeries.push({
        date: dateStr,
        views: (viewsMap.get(dateStr) || 0) + (quizViewsMap.get(dateStr) || 0),
        leads: (leadsMap.get(dateStr) || 0) + (quizLeadsMap.get(dateStr) || 0),
      });
      current.setDate(current.getDate() + 1);
    }

    res.json({ success: true, data: { timeSeries } });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Source Breakdown
// ============================================

export async function getSourceBreakdown(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ sources: SourceBreakdown[] }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const leadMagnets = await LeadMagnet.find({ userId: req.user._id }).select('_id');
    const leadMagnetIds = leadMagnets.map((lm) => lm._id);

    const quizzes = await Quiz.find({ userId: req.user._id }).select('_id');
    const quizIds = quizzes.map((q) => q._id);

    if (leadMagnetIds.length === 0 && quizIds.length === 0) {
      res.json({ success: true, data: { sources: [] } });
      return;
    }

    // Aggregate views by source (lead magnets)
    const viewsBySource = await PageView.aggregate([
      { $match: { leadMagnetId: { $in: leadMagnetIds } } },
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Aggregate leads by source (lead magnets)
    const leadsBySource = await Lead.aggregate([
      { $match: { leadMagnetId: { $in: leadMagnetIds } } },
      { $group: { _id: { $ifNull: ['$source', 'direct'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Aggregate quiz views by source (quiz starts)
    const quizViewsBySource = await QuizResponse.aggregate([
      { 
        $match: { 
          quizId: { $in: quizIds },
          startedAt: { $exists: true },
        } 
      },
      { $group: { _id: { $ifNull: ['$source', 'direct'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Aggregate quiz leads by source (email captures)
    const quizLeadsBySource = await QuizResponse.aggregate([
      { 
        $match: { 
          quizId: { $in: quizIds },
          email: { $exists: true, $ne: '' },
        } 
      },
      { $group: { _id: { $ifNull: ['$source', 'direct'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Merge into source breakdown
    const viewsMap = new Map(viewsBySource.map((v) => [v._id, v.count]));
    const leadsMap = new Map(leadsBySource.map((l) => [l._id, l.count]));
    const quizViewsMap = new Map(quizViewsBySource.map((v) => [v._id, v.count]));
    const quizLeadsMap = new Map(quizLeadsBySource.map((l) => [l._id, l.count]));

    // Get all unique sources from all maps
    const allSources = new Set([
      ...viewsMap.keys(),
      ...leadsMap.keys(),
      ...quizViewsMap.keys(),
      ...quizLeadsMap.keys(),
    ]);

    const sources: SourceBreakdown[] = Array.from(allSources).map((source) => {
      const views = (viewsMap.get(source) || 0) + (quizViewsMap.get(source) || 0);
      const leads = (leadsMap.get(source) || 0) + (quizLeadsMap.get(source) || 0);
      return {
        source: source || 'direct',
        views,
        leads,
        conversionRate: views > 0 ? Math.round((leads / views) * 10000) / 100 : 0,
      };
    });

    // Sort by leads (most valuable sources first)
    sources.sort((a, b) => b.leads - a.leads);

    res.json({ success: true, data: { sources } });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Funnel Performance
// ============================================

export async function getFunnelPerformance(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ funnels: FunnelPerformance[] }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const leadMagnets = await LeadMagnet.find({ userId: req.user._id })
      .select('_id title slug type')
      .lean();

    const quizzes = await Quiz.find({ userId: req.user._id })
      .select('_id title slug stats')
      .lean();

    if (leadMagnets.length === 0 && quizzes.length === 0) {
      res.json({ success: true, data: { funnels: [] } });
      return;
    }

    const leadMagnetIds = leadMagnets.map((lm) => lm._id);

    // Aggregate views by lead magnet
    const viewsByMagnet = await PageView.aggregate([
      { $match: { leadMagnetId: { $in: leadMagnetIds } } },
      { $group: { _id: '$leadMagnetId', count: { $sum: 1 } } },
    ]);

    // Aggregate leads by lead magnet
    const leadsByMagnet = await Lead.aggregate([
      { $match: { leadMagnetId: { $in: leadMagnetIds } } },
      { $group: { _id: '$leadMagnetId', count: { $sum: 1 } } },
    ]);

    const viewsMap = new Map(viewsByMagnet.map((v) => [v._id.toString(), v.count]));
    const leadsMap = new Map(leadsByMagnet.map((l) => [l._id.toString(), l.count]));

    // Map lead magnets to funnel performance
    const leadMagnetFunnels: FunnelPerformance[] = leadMagnets.map((lm) => {
      const id = lm._id.toString();
      const views = viewsMap.get(id) || 0;
      const leads = leadsMap.get(id) || 0;
      return {
        id,
        title: lm.title || 'Untitled',
        slug: lm.slug,
        type: lm.type,
        views,
        leads,
        conversionRate: views > 0 ? Math.round((leads / views) * 10000) / 100 : 0,
      };
    });

    // Map quizzes to funnel performance
    const quizFunnels: FunnelPerformance[] = quizzes.map((quiz) => {
      const views = quiz.stats?.views || 0;
      const leads = quiz.stats?.emailsCaptured || 0;
      return {
        id: quiz._id.toString(),
        title: quiz.title || 'Untitled Quiz',
        slug: quiz.slug,
        type: 'quiz',
        views,
        leads,
        conversionRate: views > 0 ? Math.round((leads / views) * 10000) / 100 : 0,
      };
    });

    // Combine both types of funnels
    const funnels = [...leadMagnetFunnels, ...quizFunnels];

    // Sort by leads (best performers first)
    funnels.sort((a, b) => b.leads - a.leads);

    res.json({ success: true, data: { funnels } });
  } catch (error) {
    next(error);
  }
}

// ============================================
// Get Recent Activity
// ============================================

export async function getRecentActivity(
  req: AuthenticatedRequest,
  res: Response<ApiResponse<{ activities: RecentActivity[] }>>,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    const limit = parseInt(req.query.limit as string) || 20;

    const leadMagnets = await LeadMagnet.find({ userId: req.user._id })
      .select('_id title')
      .lean();

    const quizzes = await Quiz.find({ userId: req.user._id })
      .select('_id title')
      .lean();

    if (leadMagnets.length === 0 && quizzes.length === 0) {
      res.json({ success: true, data: { activities: [] } });
      return;
    }

    const leadMagnetIds = leadMagnets.map((lm) => lm._id);
    const quizIds = quizzes.map((q) => q._id);
    
    const titleMap = new Map(leadMagnets.map((lm) => [lm._id.toString(), lm.title || 'Untitled']));
    const quizTitleMap = new Map(quizzes.map((q) => [q._id.toString(), q.title || 'Untitled Quiz']));

    // Get recent leads (lead magnets)
    const recentLeads = await Lead.find({ leadMagnetId: { $in: leadMagnetIds } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('email source leadMagnetId createdAt')
      .lean();

    // Get recent views (lead magnets)
    const recentViews = await PageView.find({ leadMagnetId: { $in: leadMagnetIds } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('source leadMagnetId createdAt')
      .lean();

    // Get recent quiz email captures
    const recentQuizLeads = await QuizResponse.find({ 
      quizId: { $in: quizIds },
      email: { $exists: true, $ne: '' },
    })
      .sort({ emailCapturedAt: -1, completedAt: -1, createdAt: -1 })
      .limit(limit)
      .select('email source quizId createdAt completedAt emailCapturedAt')
      .lean();

    // Get recent quiz views (starts)
    const recentQuizViews = await QuizResponse.find({ 
      quizId: { $in: quizIds },
      startedAt: { $exists: true },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('source quizId createdAt')
      .lean();

    // Combine and sort
    const activities: RecentActivity[] = [
      ...recentLeads.map((lead) => ({
        type: 'lead' as const,
        source: lead.source || 'direct',
        leadMagnetTitle: titleMap.get(lead.leadMagnetId.toString()) || 'Unknown',
        email: lead.email,
        createdAt: lead.createdAt,
      })),
      ...recentViews.map((view) => ({
        type: 'view' as const,
        source: view.source,
        leadMagnetTitle: titleMap.get(view.leadMagnetId.toString()) || 'Unknown',
        createdAt: view.createdAt,
      })),
      ...recentQuizLeads.map((quizLead) => ({
        type: 'lead' as const,
        source: quizLead.source || 'direct',
        leadMagnetTitle: quizTitleMap.get(quizLead.quizId.toString()) || 'Unknown Quiz',
        email: quizLead.email,
        createdAt: quizLead.emailCapturedAt || quizLead.completedAt || quizLead.createdAt,
      })),
      ...recentQuizViews.map((quizView) => ({
        type: 'view' as const,
        source: quizView.source || 'direct',
        leadMagnetTitle: quizTitleMap.get(quizView.quizId.toString()) || 'Unknown Quiz',
        createdAt: quizView.createdAt,
      })),
    ];

    // Sort by time and limit
    activities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const limitedActivities = activities.slice(0, limit);

    res.json({ success: true, data: { activities: limitedActivities } });
  } catch (error) {
    next(error);
  }
}

