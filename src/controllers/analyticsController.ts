import type { Response, NextFunction } from 'express';
import { LeadMagnet } from '../models/LeadMagnet.js';
import { Lead } from '../models/Lead.js';
import { PageView } from '../models/PageView.js';
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

    if (leadMagnetIds.length === 0) {
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
    ]);

    const conversionRate = totalViews > 0 ? (totalLeads / totalViews) * 100 : 0;
    const avgLeadsPerDay = leadsLast30Days / 30;

    res.json({
      success: true,
      data: {
        stats: {
          totalViews,
          totalLeads,
          conversionRate: Math.round(conversionRate * 100) / 100,
          viewsToday,
          leadsToday,
          viewsThisWeek,
          leadsThisWeek,
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
    const startDate = getDaysAgo(days);

    const leadMagnets = await LeadMagnet.find({ userId: req.user._id }).select('_id');
    const leadMagnetIds = leadMagnets.map((lm) => lm._id);

    if (leadMagnetIds.length === 0) {
      res.json({ success: true, data: { timeSeries: [] } });
      return;
    }

    // Aggregate views by day
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
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Aggregate leads by day
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
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Create maps for quick lookup
    const viewsMap = new Map(viewsAgg.map((v) => [v._id, v.count]));
    const leadsMap = new Map(leadsAgg.map((l) => [l._id, l.count]));

    // Generate complete time series with all days
    const timeSeries: TimeSeriesPoint[] = [];
    const current = new Date(startDate);
    const end = new Date();

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      timeSeries.push({
        date: dateStr,
        views: viewsMap.get(dateStr) || 0,
        leads: leadsMap.get(dateStr) || 0,
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

    if (leadMagnetIds.length === 0) {
      res.json({ success: true, data: { sources: [] } });
      return;
    }

    // Aggregate views by source
    const viewsBySource = await PageView.aggregate([
      { $match: { leadMagnetId: { $in: leadMagnetIds } } },
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Aggregate leads by source
    const leadsBySource = await Lead.aggregate([
      { $match: { leadMagnetId: { $in: leadMagnetIds } } },
      { $group: { _id: { $ifNull: ['$source', 'direct'] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Merge into source breakdown
    const viewsMap = new Map(viewsBySource.map((v) => [v._id, v.count]));
    const leadsMap = new Map(leadsBySource.map((l) => [l._id, l.count]));

    // Get all unique sources
    const allSources = new Set([...viewsMap.keys(), ...leadsMap.keys()]);

    const sources: SourceBreakdown[] = Array.from(allSources).map((source) => {
      const views = viewsMap.get(source) || 0;
      const leads = leadsMap.get(source) || 0;
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

    if (leadMagnets.length === 0) {
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

    const funnels: FunnelPerformance[] = leadMagnets.map((lm) => {
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

    if (leadMagnets.length === 0) {
      res.json({ success: true, data: { activities: [] } });
      return;
    }

    const leadMagnetIds = leadMagnets.map((lm) => lm._id);
    const titleMap = new Map(leadMagnets.map((lm) => [lm._id.toString(), lm.title || 'Untitled']));

    // Get recent leads
    const recentLeads = await Lead.find({ leadMagnetId: { $in: leadMagnetIds } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('email source leadMagnetId createdAt')
      .lean();

    // Get recent views
    const recentViews = await PageView.find({ leadMagnetId: { $in: leadMagnetIds } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('source leadMagnetId createdAt')
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
    ];

    // Sort by time and limit
    activities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const limitedActivities = activities.slice(0, limit);

    res.json({ success: true, data: { activities: limitedActivities } });
  } catch (error) {
    next(error);
  }
}

