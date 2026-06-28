// src/services/AuthService.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSupabaseAdmin } from '../config/database.js';
import logger from '../utils/logger.js';

class AuthService {

  // ---- HASH PASSWORD ----
  async hashPassword(password) {
    return bcrypt.hash(password, 12);
  }

  // ---- VERIFY PASSWORD ----
  async verifyPassword(plain, hash) {
    return bcrypt.compare(plain, hash);
  }

  // ---- GENERATE JWT ----
  generateToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
  }

  // ---- VERIFY JWT ----
  verifyToken(token) {
    return jwt.verify(token, process.env.JWT_SECRET);
  }

  // ---- ADMIN LOGIN ----
  async login(email, password) {
    const db = getSupabaseAdmin();
    const { data: admin, error } = await db
      .from('admins')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .single();

    if (error || !admin) throw new Error('Invalid credentials');

    const valid = await this.verifyPassword(password, admin.password_hash);
    if (!valid) throw new Error('Invalid credentials');

    // Update last login
    await db.from('admins').update({ last_login: new Date().toISOString() })
      .eq('id', admin.id);

    const token = this.generateToken({ id: admin.id, email: admin.email, role: admin.role });

    logger.info('Admin login', { email: admin.email });
    return {
      token,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role }
    };
  }

  // ---- SEED FIRST ADMIN ----
  async seedAdmin() {
    const db = getSupabaseAdmin();
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;

    const { data: existing } = await db.from('admins')
      .select('id').eq('email', email).single();
    if (existing) return;

    const hash = await this.hashPassword(password);
    await db.from('admins').insert({
      email, password_hash: hash,
      name: 'Super Admin', role: 'super_admin'
    });
    logger.info('Default admin seeded', { email });
  }

  // ---- GET ADMIN BY ID ----
  async getAdminById(id) {
    const db = getSupabaseAdmin();
    const { data } = await db.from('admins')
      .select('id, email, name, role, last_login, created_at')
      .eq('id', id).single();
    return data;
  }
}

export default new AuthService();
