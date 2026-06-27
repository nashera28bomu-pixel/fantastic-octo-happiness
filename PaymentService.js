// src/services/PaymentService.js
import { getSupabaseAdmin } from '../config/database.js';
import { PAYMENT_STATUS } from '../utils/constants.js';
import logger from '../utils/logger.js';
import { nanoid } from 'nanoid';

class PaymentService {

  _getIntaSendConfig() {
    return {
      publicKey: process.env.INTASEND_PUBLIC_KEY,
      secretKey: process.env.INTASEND_SECRET_KEY,
      testMode: process.env.INTASEND_TEST_MODE === 'true'
    };
  }

  _buildApiBase() {
    const test = process.env.INTASEND_TEST_MODE === 'true';
    return test
      ? 'https://sandbox.intasend.com/api/v1'
      : 'https://payment.intasend.com/api/v1';
  }

  // ---- GET ACTIVE PAYMENT SETTINGS ----
  async getPaymentSettings() {
    const db = getSupabaseAdmin();
    const { data } = await db.from('payment_settings').select('*').limit(1).single();
    return data || { payments_enabled: true, free_mode: false, report_price: 150, currency: 'KES' };
  }

  // ---- VALIDATE COUPON ----
  async validateCoupon(code, phone, amount) {
    if (!code) return { valid: false };
    const db = getSupabaseAdmin();
    const { data: coupon } = await db
      .from('coupons')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('is_active', true)
      .single();

    if (!coupon) return { valid: false, reason: 'Invalid coupon code' };

    const now = new Date();
    if (coupon.expiry_date && new Date(coupon.expiry_date) < now)
      return { valid: false, reason: 'Coupon has expired' };
    if (coupon.start_date && new Date(coupon.start_date) > now)
      return { valid: false, reason: 'Coupon is not yet active' };
    if (coupon.max_uses && coupon.current_uses >= coupon.max_uses)
      return { valid: false, reason: 'Coupon usage limit reached' };
    if (amount < (coupon.min_purchase || 0))
      return { valid: false, reason: `Minimum purchase of KES ${coupon.min_purchase} required` };

    // Check single-use per phone
    if (coupon.single_use) {
      const { data: used } = await db.from('coupon_usage')
        .select('id').eq('coupon_id', coupon.id).eq('phone', phone).limit(1);
      if (used?.length) return { valid: false, reason: 'You have already used this coupon' };
    }

    let discountAmount = 0;
    if (coupon.discount_type === 'full')       discountAmount = amount;
    else if (coupon.discount_type === 'percentage') discountAmount = (amount * coupon.discount_value) / 100;
    else if (coupon.discount_type === 'fixed')  discountAmount = coupon.discount_value;

    const finalAmount = Math.max(0, amount - discountAmount);
    return { valid: true, coupon, discountAmount, finalAmount };
  }

  // ---- CHECK ACTIVE GIVEAWAY ----
  async checkActiveGiveaway() {
    const db = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { data } = await db
      .from('giveaways')
      .select('*')
      .eq('is_active', true)
      .lte('start_date', now)
      .gte('end_date', now)
      .limit(1)
      .single();

    if (!data) return null;
    if (data.reports_used >= data.max_reports) return null;
    return data;
  }

  // ---- INITIATE STK PUSH ----
  async initiateStkPush({ phone, amount, merchantRef, reportId }) {
    const cfg = this._getIntaSendConfig();
    const apiBase = this._buildApiBase();

    // Format phone: 0712345678 → 254712345678
    const formattedPhone = phone.replace(/^0/, '254').replace(/^\+/, '');

    const payload = {
      phone_number: formattedPhone,
      amount: Math.ceil(amount),
      currency: 'KES',
      api_ref: merchantRef,
      name: 'Cymor KUCCPS Report',
      comment: `KUCCPS Report ${merchantRef}`
    };

    logger.info('Initiating STK Push', { phone: formattedPhone, amount, merchantRef });

    const res = await fetch(`${apiBase}/payment/mpesa-stk-push/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.secretKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      logger.error('IntaSend STK Push failed', { data, status: res.status });
      throw new Error(data?.detail || data?.message || 'Payment initiation failed');
    }

    logger.info('STK Push initiated', { invoiceId: data.invoice?.invoice_id });
    return data;
  }

  // ---- CREATE PAYMENT RECORD ----
  async createPayment({ reportId, phone, couponCode, giveawayId, isFree = false }) {
    const db = getSupabaseAdmin();
    const settings = await this.getPaymentSettings();
    const baseAmount = settings.report_price;
    const merchantRef = `CYMOR-${nanoid(10).toUpperCase()}`;

    let finalAmount = baseAmount;
    let discountAmount = 0;
    let couponId = null;
    let stkData = null;

    // Free mode / admin bypass
    if (settings.free_mode || isFree) {
      const { data: payment, error } = await db.from('payments').insert({
        report_id: reportId,
        phone_number: phone,
        amount: baseAmount,
        currency: settings.currency,
        merchant_reference: merchantRef,
        final_amount: 0,
        discount_amount: baseAmount,
        is_free: true,
        giveaway_id: giveawayId || null,
        status: PAYMENT_STATUS.PAID,
        paid_at: new Date().toISOString()
      }).select().single();
      if (error) throw new Error(error.message);
      return { payment, isFree: true, requiresPayment: false };
    }

    // Validate coupon
    if (couponCode) {
      const couponResult = await this.validateCoupon(couponCode, phone, baseAmount);
      if (couponResult.valid) {
        discountAmount = couponResult.discountAmount;
        finalAmount = couponResult.finalAmount;
        couponId = couponResult.coupon.id;

        // Record coupon usage
        await db.from('coupon_usage').insert({
          coupon_id: couponId,
          phone,
          payment_id: null // update after payment created
        });
        // Increment coupon use count
        await db.from('coupons').update({ current_uses: couponResult.coupon.current_uses + 1 })
          .eq('id', couponId);
      }
    }

    // If full discount → free
    if (finalAmount <= 0) {
      const { data: payment, error } = await db.from('payments').insert({
        report_id: reportId,
        phone_number: phone,
        amount: baseAmount,
        currency: settings.currency,
        merchant_reference: merchantRef,
        final_amount: 0,
        discount_amount: discountAmount,
        coupon_id: couponId,
        is_free: true,
        status: PAYMENT_STATUS.PAID,
        paid_at: new Date().toISOString()
      }).select().single();
      if (error) throw new Error(error.message);
      return { payment, isFree: true, requiresPayment: false };
    }

    // Initiate real STK Push
    stkData = await this.initiateStkPush({ phone, amount: finalAmount, merchantRef, reportId });

    const { data: payment, error } = await db.from('payments').insert({
      report_id: reportId,
      phone_number: phone,
      amount: baseAmount,
      currency: settings.currency,
      merchant_reference: merchantRef,
      intasend_invoice_id: stkData.invoice?.invoice_id || null,
      final_amount: finalAmount,
      discount_amount: discountAmount,
      coupon_id: couponId,
      giveaway_id: giveawayId || null,
      is_free: false,
      status: PAYMENT_STATUS.PENDING,
      expired_at: new Date(Date.now() + (settings.payment_timeout_min || 10) * 60 * 1000).toISOString()
    }).select().single();

    if (error) throw new Error(error.message);

    await this._logPaymentEvent(payment.id, 'stk_push_initiated', { stkData });

    return { payment, isFree: false, requiresPayment: true, stkData };
  }

  // ---- POLL PAYMENT STATUS ----
  async getPaymentStatus(merchantRef) {
    const db = getSupabaseAdmin();
    const { data: payment, error } = await db
      .from('payments')
      .select('*')
      .eq('merchant_reference', merchantRef)
      .single();

    if (error || !payment) return null;

    // Check expiry
    if (payment.status === PAYMENT_STATUS.PENDING && payment.expired_at) {
      if (new Date(payment.expired_at) < new Date()) {
        await db.from('payments').update({ status: PAYMENT_STATUS.EXPIRED })
          .eq('id', payment.id);
        return { ...payment, status: PAYMENT_STATUS.EXPIRED };
      }
    }

    return payment;
  }

  // ---- VERIFY WITH INTASEND (manual check) ----
  async verifyWithIntaSend(invoiceId) {
    const cfg = this._getIntaSendConfig();
    const apiBase = this._buildApiBase();

    const res = await fetch(`${apiBase}/payment/collection/?invoice_id=${invoiceId}`, {
      headers: { 'Authorization': `Bearer ${cfg.secretKey}` }
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.[0] || null;
  }

  // ---- HANDLE WEBHOOK ----
  async handleWebhook(payload) {
    const db = getSupabaseAdmin();

    logger.info('Webhook received', { payload });

    const invoiceId  = payload.invoice_id || payload.invoice?.invoice_id;
    const state      = payload.state || payload.invoice?.state;
    const apiRef     = payload.api_ref || payload.invoice?.api_ref;

    // Find payment by merchant ref or invoice id
    let query = db.from('payments').select('*');
    if (apiRef)    query = query.eq('merchant_reference', apiRef);
    else if (invoiceId) query = query.eq('intasend_invoice_id', invoiceId);

    const { data: payment } = await query.single();
    if (!payment) {
      logger.warn('Webhook: payment not found', { invoiceId, apiRef });
      return null;
    }

    // Map IntaSend state to our status
    const statusMap = {
      'COMPLETE':    PAYMENT_STATUS.PAID,
      'FAILED':      PAYMENT_STATUS.FAILED,
      'CANCELLED':   PAYMENT_STATUS.CANCELLED,
      'PENDING':     PAYMENT_STATUS.PENDING,
    };
    const newStatus = statusMap[state] || PAYMENT_STATUS.PENDING;

    await db.from('payments').update({
      status: newStatus,
      intasend_invoice_id: invoiceId || payment.intasend_invoice_id,
      webhook_payload: payload,
      paid_at: newStatus === PAYMENT_STATUS.PAID ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq('id', payment.id);

    await this._logPaymentEvent(payment.id, `webhook_${state?.toLowerCase()}`, { payload });

    // Update coupon usage with payment_id
    if (payment.coupon_id) {
      await db.from('coupon_usage').update({ payment_id: payment.id })
        .eq('coupon_id', payment.coupon_id).is('payment_id', null);
    }

    return { payment, newStatus };
  }

  // ---- REVENUE ANALYTICS ----
  async getRevenueStats() {
    const db = getSupabaseAdmin();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const [allTime, todayData, monthData, failed, pending] = await Promise.all([
      db.from('payments').select('final_amount').eq('status', 'paid'),
      db.from('payments').select('final_amount').eq('status', 'paid').gte('paid_at', today.toISOString()),
      db.from('payments').select('final_amount').eq('status', 'paid').gte('paid_at', thisMonth.toISOString()),
      db.from('payments').select('id', { count: 'exact' }).eq('status', 'failed'),
      db.from('payments').select('id', { count: 'exact' }).eq('status', 'pending'),
    ]);

    const sum = (rows) => (rows.data || []).reduce((acc, r) => acc + (r.final_amount || 0), 0);

    return {
      total_revenue:   sum(allTime),
      today_revenue:   sum(todayData),
      monthly_revenue: sum(monthData),
      total_paid:      allTime.data?.length || 0,
      total_failed:    failed.count || 0,
      total_pending:   pending.count || 0
    };
  }

  async _logPaymentEvent(paymentId, event, data) {
    const db = getSupabaseAdmin();
    await db.from('payment_logs').insert({ payment_id: paymentId, event, data });
  }
}

export default new PaymentService();
