// src/controllers/AdminController.js
import AuthService from '../services/AuthService.js';
import ImportService from '../services/ImportService.js';
import PaymentService from '../services/PaymentService.js';
import ReportService from '../services/ReportService.js';
import { getSupabaseAdmin } from '../config/database.js';
import { sendSuccess, sendError, sendPaginated } from '../utils/response.js';
import logger from '../utils/logger.js';
import { nanoid } from 'nanoid';

class AdminController {

  // ---- AUTH ----
  async login(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) return sendError(res, 'Email and password required', 400);
      const result = await AuthService.login(email, password);
      return sendSuccess(res, result, 'Login successful');
    } catch (err) {
      return sendError(res, err.message, 401);
    }
  }

  async me(req, res) {
    try {
      const admin = await AuthService.getAdminById(req.admin.id);
      return sendSuccess(res, admin);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // ---- DASHBOARD STATS ----
  async getDashboardStats(req, res) {
    try {
      const db = getSupabaseAdmin();
      const [revenue, reports, universities, courses] = await Promise.all([
        PaymentService.getRevenueStats(),
        db.from('reports').select('id', { count: 'exact' }),
        db.from('universities').select('id', { count: 'exact' }),
        db.from('courses').select('id', { count: 'exact' }).eq('is_active', true)
      ]);

      // Recent reports
      const { data: recentReports } = await db.from('reports')
        .select('id, report_code, student_name, mean_grade, status, created_at')
        .order('created_at', { ascending: false }).limit(10);

      // Top courses
      const { data: topCourses } = await db.from('report_courses')
        .select('courses(name, universities(name))', { count: 'exact' })
        .limit(5);

      return sendSuccess(res, {
        revenue,
        total_reports:      reports.count || 0,
        total_universities: universities.count || 0,
        total_courses:      courses.count || 0,
        recent_reports:     recentReports || [],
        top_courses:        topCourses || []
      });
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // ---- REPORTS ----
  async listReports(req, res) {
    try {
      const { page = 1, limit = 20, status, search } = req.query;
      const { data, total } = await ReportService.listReports({ page, limit, status, search });
      return sendPaginated(res, data, total, page, limit);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // ---- UNIVERSITIES ----
  async listUniversities(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { page = 1, limit = 50, search } = req.query;
      const offset = (page - 1) * limit;

      let query = db.from('universities')
        .select('*', { count: 'exact' })
        .order('name').range(offset, offset + limit - 1);

      if (search) query = query.ilike('name', `%${search}%`);
      const { data, count, error } = await query;
      if (error) throw new Error(error.message);
      return sendPaginated(res, data, count, page, limit);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async createUniversity(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { name, short_name, type, county, town, website } = req.body;
      if (!name) return sendError(res, 'University name required', 400);
      const { data, error } = await db.from('universities').insert({
        name, short_name, type: type || 'Public', county, town, website
      }).select().single();
      if (error) throw new Error(error.message);
      return sendSuccess(res, data, 'University created', 201);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // ---- COURSES ----
  async listCourses(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { page = 1, limit = 50, search, university_id, admission_year } = req.query;
      const offset = (page - 1) * limit;

      let query = db.from('courses')
        .select('*, universities(name, county)', { count: 'exact' })
        .order('name').range(offset, offset + limit - 1);

      if (search)        query = query.ilike('name', `%${search}%`);
      if (university_id) query = query.eq('university_id', university_id);
      if (admission_year) query = query.eq('admission_year', admission_year);

      const { data, count, error } = await query;
      if (error) throw new Error(error.message);
      return sendPaginated(res, data, count, page, limit);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // ---- IMPORT ----
  async uploadImportFile(req, res) {
    try {
      if (!req.file) return sendError(res, 'File required', 400);
      const { admission_year } = req.body;
      if (!admission_year) return sendError(res, 'Admission year required', 400);

      const db = getSupabaseAdmin();

      // Upload to Supabase Storage
      const fileName = `imports/${nanoid()}_${req.file.originalname}`;
      const { error: uploadErr } = await db.storage
        .from('kuccps-imports')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype, upsert: false
        });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      // Create import log
      const { data: log, error: logErr } = await db.from('import_logs').insert({
        admin_id:       req.admin.id,
        source_type:    req.file.mimetype.includes('pdf') ? 'PDF' : 'EXCEL',
        source_file_url: fileName,
        file_name:      req.file.originalname,
        admission_year: parseInt(admission_year),
        status:         'pending'
      }).select().single();

      if (logErr) throw new Error(logErr.message);

      // Run preview
      const preview = await ImportService.previewImport(
        req.file.buffer, req.file.mimetype, parseInt(admission_year), log.id
      );

      return sendSuccess(res, { logId: log.id, ...preview }, 'File uploaded and previewed', 201);
    } catch (err) {
      logger.error('Upload import error', { error: err.message });
      return sendError(res, err.message, 500);
    }
  }

  async confirmImport(req, res) {
    try {
      const { logId } = req.params;
      const { admission_year } = req.body;
      const result = await ImportService.commitImport(logId, parseInt(admission_year), req.admin.id);
      return sendSuccess(res, result, 'Import committed successfully');
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async rollbackImport(req, res) {
    try {
      const { logId } = req.params;
      await ImportService.rollbackImport(logId);
      return sendSuccess(res, null, 'Import rolled back');
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async listImports(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { data } = await db.from('import_logs')
        .select('*, admins(name, email)')
        .order('created_at', { ascending: false }).limit(50);
      return sendSuccess(res, data || []);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // ---- PAYMENT SETTINGS ----
  async getPaymentSettings(req, res) {
    try {
      const settings = await PaymentService.getPaymentSettings();
      return sendSuccess(res, settings);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async updatePaymentSettings(req, res) {
    try {
      const db = getSupabaseAdmin();
      const allowed = ['payments_enabled','free_mode','report_price','currency','provider','sandbox_mode','payment_timeout_min'];
      const updates = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      updates.updated_at = new Date().toISOString();
      const { data, error } = await db.from('payment_settings').update(updates)
        .eq('id', (await PaymentService.getPaymentSettings()).id).select().single();
      if (error) throw new Error(error.message);
      return sendSuccess(res, data, 'Payment settings updated');
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // ---- COUPONS ----
  async listCoupons(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { data } = await db.from('coupons').select('*').order('created_at', { ascending: false });
      return sendSuccess(res, data || []);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async createCoupon(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { code, description, discount_type, discount_value, max_uses, start_date, expiry_date, single_use, min_purchase } = req.body;
      if (!code || !discount_type) return sendError(res, 'Code and discount type required', 400);

      const { data, error } = await db.from('coupons').insert({
        code: code.toUpperCase(), description,
        discount_type, discount_value: parseFloat(discount_value || 0),
        max_uses: max_uses || null, start_date: start_date || null,
        expiry_date: expiry_date || null,
        single_use: !!single_use,
        min_purchase: parseFloat(min_purchase || 0)
      }).select().single();

      if (error) throw new Error(error.message);
      return sendSuccess(res, data, 'Coupon created', 201);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async updateCoupon(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { id } = req.params;
      const { data, error } = await db.from('coupons')
        .update({ ...req.body, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return sendSuccess(res, data, 'Coupon updated');
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async deleteCoupon(req, res) {
    try {
      const db = getSupabaseAdmin();
      await db.from('coupons').update({ is_active: false }).eq('id', req.params.id);
      return sendSuccess(res, null, 'Coupon deactivated');
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // ---- GIVEAWAYS ----
  async listGiveaways(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { data } = await db.from('giveaways').select('*').order('created_at', { ascending: false });
      return sendSuccess(res, data || []);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async createGiveaway(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { title, description, max_reports, start_date, end_date } = req.body;
      if (!title || !max_reports || !start_date || !end_date)
        return sendError(res, 'Title, max reports, start and end date required', 400);

      const { data, error } = await db.from('giveaways').insert({
        title, description, max_reports: parseInt(max_reports), start_date, end_date
      }).select().single();
      if (error) throw new Error(error.message);
      return sendSuccess(res, data, 'Giveaway created', 201);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async updateGiveaway(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { data, error } = await db.from('giveaways')
        .update({ ...req.body, updated_at: new Date().toISOString() })
        .eq('id', req.params.id).select().single();
      if (error) throw new Error(error.message);
      return sendSuccess(res, data, 'Giveaway updated');
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // ---- FEATURE FLAGS ----
  async getFeatureFlags(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { data } = await db.from('feature_flags').select('*').order('name');
      return sendSuccess(res, data || []);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async toggleFeatureFlag(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { name } = req.params;
      const { is_enabled } = req.body;
      const { data, error } = await db.from('feature_flags')
        .update({ is_enabled: !!is_enabled, updated_at: new Date().toISOString() })
        .eq('name', name).select().single();
      if (error) throw new Error(error.message);
      return sendSuccess(res, data, `Feature "${name}" ${is_enabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // ---- ANNOUNCEMENTS ----
  async listAnnouncements(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { data } = await db.from('announcements')
        .select('*').order('created_at', { ascending: false });
      return sendSuccess(res, data || []);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async createAnnouncement(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { title, body, type, starts_at, ends_at } = req.body;
      if (!title || !body) return sendError(res, 'Title and body required', 400);
      const { data, error } = await db.from('announcements')
        .insert({ title, body, type: type || 'info', starts_at, ends_at })
        .select().single();
      if (error) throw new Error(error.message);
      return sendSuccess(res, data, 'Announcement created', 201);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async deleteAnnouncement(req, res) {
    try {
      const db = getSupabaseAdmin();
      await db.from('announcements').update({ is_active: false }).eq('id', req.params.id);
      return sendSuccess(res, null, 'Announcement removed');
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // ---- SYSTEM SETTINGS ----
  async getSettings(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { data } = await db.from('settings').select('*').order('key');
      // Convert array to key-value object
      const map = {};
      (data || []).forEach(s => { map[s.key] = s.value; });
      return sendSuccess(res, map);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  async updateSetting(req, res) {
    try {
      const db = getSupabaseAdmin();
      const { key } = req.params;
      const { value } = req.body;
      const { data, error } = await db.from('settings')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
        .select().single();
      if (error) throw new Error(error.message);
      return sendSuccess(res, data, 'Setting updated');
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // ---- ANALYTICS ----
  async getAnalytics(req, res) {
    try {
      const db = getSupabaseAdmin();
      const revenue = await PaymentService.getRevenueStats();

      // Grade distribution
      const { data: gradeData } = await db.from('reports')
        .select('mean_grade').eq('status', 'ready');
      const grades = {};
      (gradeData || []).forEach(r => {
        grades[r.mean_grade] = (grades[r.mean_grade] || 0) + 1;
      });

      // Popular courses
      const { data: popularCourses } = await db.from('report_courses')
        .select('courses(name, universities(name))', { count: 'exact' })
        .order('id', { ascending: false }).limit(10);

      return sendSuccess(res, { revenue, grade_distribution: grades, popular_courses: popularCourses || [] });
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }
}

export default new AdminController();
