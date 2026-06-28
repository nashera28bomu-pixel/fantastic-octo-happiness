// src/controllers/ReportController.js
import ReportService from '../services/ReportService.js';
import PaymentService from '../services/PaymentService.js';
import ClusterService from '../services/ClusterService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { getSupabaseAdmin } from '../config/database.js';
import logger from '../utils/logger.js';

class ReportController {

  // POST /api/v1/reports/initiate
  async initiateReport(req, res) {
    try {
      const { studentName, phone, email, schoolName, kcseYear, grades, couponCode } = req.body;

      // Basic validation
      if (!studentName || !phone || !kcseYear || !grades) {
        return sendError(res, 'Student name, phone, KCSE year and grades are required', 400);
      }
      if (Object.keys(grades).length < 7) {
        return sendError(res, 'Please enter at least 7 subjects', 400);
      }

      // 1. Preview analysis (fast, no DB write)
      const { meanGrade, meanPoints } = ClusterService.calculateMeanGrade(grades);

      // 2. Create pending report
      const report = await ReportService.createPendingReport({
        studentName, phone, email, schoolName, kcseYear, grades
      });

      // 3. Check giveaway
      const giveaway = await PaymentService.checkActiveGiveaway();

      // 4. Create payment (handles free/coupon/full)
      const { payment, isFree, requiresPayment, stkData } = await PaymentService.createPayment({
        reportId: report.id,
        phone,
        couponCode: couponCode || null,
        giveawayId: giveaway?.id || null
      });

      // 5. Link payment to report
      await ReportService.linkPayment(report.id, payment.id);

      // 6. If free/already paid → generate immediately
      if (isFree || !requiresPayment) {
        // Async — don't block response
        ReportService.generateReport(report.id).catch(err =>
          logger.error('Async report gen failed', { error: err.message })
        );
      }

      return sendSuccess(res, {
        reportId:         report.id,
        reportCode:       report.report_code,
        merchantRef:      payment.merchant_reference,
        requiresPayment,
        isFree,
        meanGrade,
        meanPoints,
        finalAmount:      payment.final_amount,
        discountAmount:   payment.discount_amount,
        stkInitiated:     requiresPayment && !!stkData
      }, 'Report initiated', 201);

    } catch (err) {
      logger.error('initiateReport error', { error: err.message });
      return sendError(res, err.message, 500);
    }
  }

  // GET /api/v1/reports/status/:merchantRef
  async getStatus(req, res) {
    try {
      const { merchantRef } = req.params;
      const payment = await PaymentService.getPaymentStatus(merchantRef);
      if (!payment) return sendError(res, 'Payment not found', 404);

      let reportStatus = null;
      if (payment.report_id) {
        reportStatus = await ReportService.getReportStatus(payment.report_id);

        // If payment is now PAID but report not generating yet → trigger generation
        if (payment.status === 'paid' && reportStatus?.status === 'pending') {
          ReportService.generateReport(payment.report_id).catch(err =>
            logger.error('Triggered report gen failed', { error: err.message })
          );
        }
      }

      return sendSuccess(res, {
        paymentStatus: payment.status,
        reportStatus:  reportStatus?.status || null,
        reportCode:    reportStatus?.report_code || null,
        pdfReady:      reportStatus?.status === 'ready',
        paidAt:        payment.paid_at
      });

    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // GET /api/v1/reports/:reportCode
  async getReport(req, res) {
    try {
      const { reportCode } = req.params;
      const report = await ReportService.getReportByCode(reportCode);

      if (!report) return sendError(res, 'Report not found', 404);
      if (report.status !== 'ready') {
        return sendError(res, `Report is ${report.status}. Please wait.`, 202);
      }

      // Check payment
      const paymentOk = report.payments?.status === 'paid';
      if (!paymentOk) return sendError(res, 'Payment not confirmed', 402);

      // Check expiry
      if (report.expires_at && new Date(report.expires_at) < new Date()) {
        return sendError(res, 'This report has expired', 410);
      }

      return sendSuccess(res, {
        report: {
          id:           report.id,
          report_code:  report.report_code,
          student_name: report.student_name,
          kcse_year:    report.kcse_year,
          mean_grade:   report.mean_grade,
          mean_points:  report.mean_points,
          grades:       report.grades,
          generated_at: report.generated_at,
          pdf_url:      report.pdf_url,
          pdf_downloads: report.pdf_downloads,
          pdf_max_downloads: report.pdf_max_downloads
        },
        courses: report.report_courses || []
      });

    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // POST /api/v1/reports/:reportCode/download
  async trackDownload(req, res) {
    try {
      const { reportCode } = req.params;
      const report = await ReportService.getReportByCode(reportCode);
      if (!report) return sendError(res, 'Report not found', 404);

      const ok = await ReportService.trackDownload(report.id);
      if (!ok) return sendError(res, 'Download limit reached', 429);

      return sendSuccess(res, { pdfUrl: report.pdf_url });
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // POST /api/v1/reports/validate-coupon
  async validateCoupon(req, res) {
    try {
      const { code, phone, amount } = req.body;
      const result = await PaymentService.validateCoupon(code, phone, amount || 150);
      if (!result.valid) return sendError(res, result.reason, 400);
      return sendSuccess(res, {
        discountType:   result.coupon.discount_type,
        discountValue:  result.coupon.discount_value,
        discountAmount: result.discountAmount,
        finalAmount:    result.finalAmount
      });
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }

  // POST /api/v1/reports/preview-grades (free instant preview)
  async previewGrades(req, res) {
    try {
      const { grades } = req.body;
      if (!grades || Object.keys(grades).length < 3) {
        return sendError(res, 'Enter at least 3 subjects', 400);
      }
      const result = ClusterService.calculateMeanGrade(grades);
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err.message, 500);
    }
  }
}

export default new ReportController();
