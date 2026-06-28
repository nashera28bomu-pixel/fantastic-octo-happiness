// src/services/ReportService.js
import { getSupabaseAdmin } from '../config/database.js';
import { REPORT_STATUS } from '../utils/constants.js';
import ClusterService from './ClusterService.js';
import PdfService from './PdfService.js';
import logger from '../utils/logger.js';
import { nanoid } from 'nanoid';

class ReportService {

  // ---- GENERATE UNIQUE REPORT CODE ----
  _generateReportCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'RPT-';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // ---- CREATE PENDING REPORT ----
  async createPendingReport({ studentName, phone, email, schoolName, kcseYear, grades }) {
    const db = getSupabaseAdmin();

    // Calculate mean grade immediately for storage
    const { meanGrade, meanPoints } = ClusterService.calculateMeanGrade(grades);

    const reportCode = this._generateReportCode();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(process.env.REPORT_EXPIRY_DAYS || 90));

    const { data: report, error } = await db.from('reports').insert({
      report_code:  reportCode,
      student_name: studentName,
      phone_number: phone,
      email:        email || null,
      school_name:  schoolName || null,
      kcse_year:    kcseYear,
      grades:       grades,
      mean_grade:   meanGrade,
      mean_points:  meanPoints,
      status:       REPORT_STATUS.PENDING,
      expires_at:   expiresAt.toISOString(),
      pdf_max_downloads: parseInt(process.env.PDF_MAX_DOWNLOADS || 5)
    }).select().single();

    if (error) throw new Error(`Failed to create report: ${error.message}`);

    logger.info('Pending report created', { reportCode, meanGrade });
    return report;
  }

  // ---- GENERATE FULL REPORT (after payment) ----
  async generateReport(reportId) {
    const db = getSupabaseAdmin();

    // Mark as generating
    await db.from('reports').update({ status: REPORT_STATUS.GENERATING })
      .eq('id', reportId);

    try {
      // Fetch report
      const { data: report, error } = await db.from('reports')
        .select('*').eq('id', reportId).single();
      if (error || !report) throw new Error('Report not found');

      // Run eligibility analysis
      const analysis = await ClusterService.analyzeEligibility(
        report.grades, report.kcse_year
      );

      // Save qualifying courses
      if (analysis.courses.length > 0) {
        const courseRows = analysis.courses.map(c => ({
          report_id:        reportId,
          course_id:        c.course_id,
          cluster_points:   c.cluster_points,
          cutoff_points:    c.cutoff_points,
          cutoff_diff:      c.cutoff_diff,
          admission_chance: c.admission_chance,
          trend:            c.trend,
          rank_position:    c.rank_position,
          recommendation:   c.recommendation,
          reason:           c.reason
        }));

        // Batch insert in chunks of 100
        for (let i = 0; i < courseRows.length; i += 100) {
          await db.from('report_courses').insert(courseRows.slice(i, i + 100));
        }
      }

      // Generate PDF
      const pdfUrl = await PdfService.generateReportPdf(report, analysis);

      // Mark ready
      const { data: updated } = await db.from('reports').update({
        status:       REPORT_STATUS.READY,
        pdf_url:      pdfUrl,
        generated_at: new Date().toISOString(),
        updated_at:   new Date().toISOString()
      }).eq('id', reportId).select().single();

      // Track analytics
      await db.from('analytics').insert({
        event_type: 'report_generated',
        report_id: reportId,
        event_data: {
          mean_grade:       analysis.meanGrade,
          qualifying_count: analysis.totalQualifying
        }
      });

      logger.info('Report generated successfully', {
        reportId, reportCode: report.report_code,
        qualifying: analysis.totalQualifying
      });

      return { report: updated, analysis };

    } catch (err) {
      logger.error('Report generation failed', { reportId, error: err.message });
      await db.from('reports').update({
        status: REPORT_STATUS.FAILED,
        updated_at: new Date().toISOString()
      }).eq('id', reportId);
      throw err;
    }
  }

  // ---- GET REPORT BY CODE ----
  async getReportByCode(reportCode) {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from('reports')
      .select(`
        *,
        payments(status, final_amount, paid_at),
        report_courses(
          *,
          courses(
            name, programme_code, degree_type, duration_years, career_field,
            universities(name, type, county, town)
          )
        )
      `)
      .eq('report_code', reportCode)
      .single();

    if (error || !data) return null;
    return data;
  }

  // ---- GET REPORT STATUS ----
  async getReportStatus(reportId) {
    const db = getSupabaseAdmin();
    const { data } = await db.from('reports')
      .select('id, report_code, status, generated_at, pdf_url, mean_grade, mean_points')
      .eq('id', reportId).single();
    return data;
  }

  // ---- LINK PAYMENT TO REPORT ----
  async linkPayment(reportId, paymentId) {
    const db = getSupabaseAdmin();
    await db.from('reports').update({ payment_id: paymentId }).eq('id', reportId);
    await db.from('payments').update({ report_id: reportId }).eq('id', paymentId);
  }

  // ---- INCREMENT DOWNLOAD COUNT ----
  async trackDownload(reportId) {
    const db = getSupabaseAdmin();
    const { data: report } = await db.from('reports')
      .select('pdf_downloads, pdf_max_downloads').eq('id', reportId).single();

    if (!report) return false;
    if (report.pdf_downloads >= report.pdf_max_downloads) return false;

    await db.from('reports').update({
      pdf_downloads: report.pdf_downloads + 1
    }).eq('id', reportId);

    return true;
  }

  // ---- LIST REPORTS (admin) ----
  async listReports({ page = 1, limit = 20, status, search } = {}) {
    const db = getSupabaseAdmin();
    const offset = (page - 1) * limit;

    let query = db.from('reports')
      .select('id, report_code, student_name, phone_number, kcse_year, mean_grade, status, generated_at, created_at, payments(status, final_amount)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (search) query = query.or(`student_name.ilike.%${search}%,phone_number.ilike.%${search}%,report_code.ilike.%${search}%`);

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);
    return { data, total: count };
  }
}

export default new ReportService();
