// src/controllers/WebhookController.js
import PaymentService from '../services/PaymentService.js';
import ReportService from '../services/ReportService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import logger from '../utils/logger.js';

class WebhookController {

  // POST /api/v1/webhooks/intasend
  async handleIntaSend(req, res) {
    try {
      // Acknowledge immediately — IntaSend requires fast response
      res.status(200).json({ received: true });

      const payload = req.body;
      logger.info('IntaSend webhook', { payload });

      const result = await PaymentService.handleWebhook(payload);
      if (!result) return;

      const { payment, newStatus } = result;

      // If payment confirmed → generate report
      if (newStatus === 'paid' && payment.report_id) {
        const reportStatus = await ReportService.getReportStatus(payment.report_id);
        if (reportStatus?.status === 'pending') {
          logger.info('Triggering report generation after payment', { reportId: payment.report_id });
          ReportService.generateReport(payment.report_id).catch(err =>
            logger.error('Post-webhook report gen failed', { error: err.message, reportId: payment.report_id })
          );
        }
      }

    } catch (err) {
      logger.error('Webhook processing error', { error: err.message });
      // Response already sent above
    }
  }
}

export default new WebhookController();
