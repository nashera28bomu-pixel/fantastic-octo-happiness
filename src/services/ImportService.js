// src/services/ImportService.js
import xlsx from 'xlsx';
import { getSupabaseAdmin } from '../config/database.js';
import logger from '../utils/logger.js';
import { GRADE_POINTS } from '../utils/constants.js';

class ImportService {

  // ---- PARSE EXCEL/CSV FILE ----
  parseFile(buffer, mimetype) {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(sheet, { defval: '' });
  }

  // ---- NORMALIZE COURSE ROW ----
  _normalizeRow(row) {
    // Handle various column name conventions from KUCCPS PDFs
    const get = (...keys) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== '') return String(row[k]).trim();
      }
      return null;
    };

    return {
      programme_code: get('Programme Code', 'Code', 'PROGRAMME CODE', 'code'),
      course_name:    get('Course', 'Programme', 'COURSE', 'PROGRAMME', 'course_name'),
      university:     get('University', 'Institution', 'UNIVERSITY', 'university_name'),
      degree_type:    get('Type', 'Degree Type', 'DEGREE TYPE') || 'Degree',
      duration:       parseInt(get('Duration', 'Years', 'DURATION') || '4'),
      cluster_group:  parseInt(get('Cluster', 'Cluster Group', 'CLUSTER GROUP') || '1'),
      county:         get('County', 'COUNTY'),
      cutoff:         parseFloat(get('Cut-off', 'Cutoff', 'CUT-OFF POINTS', 'cutoff_points') || '0'),
      quota:          parseInt(get('Quota', 'QUOTA', 'Capacity') || '0'),
      career_field:   get('Career', 'Career Field', 'CAREER FIELD'),
      subjects:       get('Subject Requirements', 'Requirements', 'SUBJECTS')
    };
  }

  // ---- VALIDATE ROW ----
  _validateRow(row, idx) {
    const errors = [];
    if (!row.programme_code) errors.push('Missing programme code');
    if (!row.course_name)    errors.push('Missing course name');
    if (!row.university)     errors.push('Missing university');
    if (row.cutoff && (row.cutoff < 10 || row.cutoff > 48))
      errors.push(`Suspicious cutoff: ${row.cutoff}`);
    return errors;
  }

  // ---- PARSE SUBJECT REQUIREMENTS STRING ----
  // e.g. "Math B+, Eng C+, 2 of: Bio C, Chem C, Phy C"
  parseSubjectRequirements(reqString) {
    if (!reqString) return [];
    const requirements = [];
    let groupId = 1;

    const parts = reqString.split(',').map(p => p.trim());
    let inGroup = false;
    let groupCount = 1;

    for (const part of parts) {
      // Detect "N of:" pattern
      const ofMatch = part.match(/^(\d+)\s+of:\s*(.+)$/i);
      if (ofMatch) {
        groupCount = parseInt(ofMatch[1]);
        const subjectStr = ofMatch[2];
        const subjectParts = subjectStr.split(/\s+and\s+|\s+or\s+|\//).map(s => s.trim());
        for (const sp of subjectParts) {
          const { subject, grade } = this._parseSubjectGrade(sp);
          if (subject) {
            requirements.push({
              requirement_type: 'elective_group',
              subject_name: subject,
              min_grade: grade || 'C',
              group_id: groupId,
              count_required: groupCount
            });
          }
        }
        groupId++;
        continue;
      }

      // Compulsory subject
      const { subject, grade } = this._parseSubjectGrade(part);
      if (subject) {
        requirements.push({
          requirement_type: 'compulsory',
          subject_name: subject,
          min_grade: grade || 'C',
          group_id: 0,
          count_required: 1
        });
      }
    }
    return requirements;
  }

  // ---- PARSE SUBJECT + GRADE from string ----
  // e.g. "Math B+" → { subject: 'Mathematics', grade: 'B+' }
  _parseSubjectGrade(str) {
    const subjectMap = {
      'math': 'Mathematics', 'maths': 'Mathematics',
      'eng': 'English', 'english': 'English',
      'kis': 'Kiswahili', 'kiswahili': 'Kiswahili', 'swahili': 'Kiswahili',
      'bio': 'Biology', 'biology': 'Biology',
      'chem': 'Chemistry', 'chemistry': 'Chemistry',
      'phy': 'Physics', 'physics': 'Physics',
      'his': 'History & Government', 'history': 'History & Government',
      'geo': 'Geography', 'geography': 'Geography',
      'cre': 'CRE', 'ire': 'IRE', 'hre': 'HRE',
      'bst': 'Business Studies', 'business': 'Business Studies',
      'agr': 'Agriculture', 'agriculture': 'Agriculture',
      'home': 'Home Science', 'home science': 'Home Science',
      'comp': 'Computer Studies', 'computer': 'Computer Studies',
      'art': 'Art & Design', 'music': 'Music', 'french': 'French'
    };

    const gradePattern = /(A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|E)$/i;
    const gradeMatch = str.match(gradePattern);
    const grade = gradeMatch ? gradeMatch[0].toUpperCase() : null;
    const subjectRaw = str.replace(gradePattern, '').trim().toLowerCase();
    const subject = subjectMap[subjectRaw] || null;

    return { subject, grade };
  }

  // ---- UPSERT UNIVERSITY ----
  async _upsertUniversity(db, name, county, type = 'Public') {
    const { data: existing } = await db.from('universities')
      .select('id').ilike('name', name.trim()).limit(1);

    if (existing?.length) return existing[0].id;

    const { data: created } = await db.from('universities').insert({
      name: name.trim(),
      county: county?.trim() || null,
      type
    }).select('id').single();

    return created?.id;
  }

  // ---- PREVIEW IMPORT ----
  async previewImport(buffer, mimetype, admissionYear, logId) {
    const db = getSupabaseAdmin();
    const rows = this.parseFile(buffer, mimetype);

    const preview = [];
    let valid = 0, skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const normalized = this._normalizeRow(rows[i]);
      const rowErrors = this._validateRow(normalized, i);

      if (rowErrors.length) {
        skipped++;
        errors.push({ row: i + 2, errors: rowErrors, data: normalized });
        preview.push({ ...normalized, _row: i + 2, _status: 'error', _errors: rowErrors });
      } else {
        valid++;
        preview.push({ ...normalized, _row: i + 2, _status: 'valid', _errors: [] });
      }
    }

    // Update import log
    await db.from('import_logs').update({
      rows_found: rows.length, rows_valid: valid, rows_skipped: skipped,
      errors_json: errors, status: 'ready_for_review'
    }).eq('id', logId);

    return {
      total: rows.length, valid, skipped,
      preview: preview.slice(0, 100),
      errors: errors.slice(0, 50)
    };
  }

  // ---- COMMIT IMPORT ----
  async commitImport(logId, admissionYear, adminId) {
    const db = getSupabaseAdmin();

    const { data: log } = await db.from('import_logs').select('*').eq('id', logId).single();
    if (!log) throw new Error('Import log not found');
    if (log.status !== 'ready_for_review') throw new Error('Import not ready to commit');

    // Check threshold
    const validPct = log.rows_valid / log.rows_found;
    if (validPct < 0.95) throw new Error(`Only ${(validPct * 100).toFixed(1)}% of rows are valid. Fix mapping first.`);

    await db.from('import_logs').update({ status: 'processing' }).eq('id', logId);

    // Re-read file and process
    const startTime = Date.now();
    let imported = 0, updated = 0;

    // Read source file from storage
    const { data: fileData } = await db.storage.from('kuccps-imports').download(log.source_file_url);
    if (!fileData) throw new Error('Source file not found in storage');

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const rows = this.parseFile(buffer, 'xlsx');

    for (const row of rows) {
      try {
        const normalized = this._normalizeRow(row);
        const rowErrors = this._validateRow(normalized, 0);
        if (rowErrors.length) continue;

        // Upsert university
        const universityId = await this._upsertUniversity(db, normalized.university, normalized.county);
        if (!universityId) continue;

        // Upsert course
        const courseData = {
          university_id: universityId,
          name: normalized.course_name,
          programme_code: normalized.programme_code,
          degree_type: normalized.degree_type || 'Degree',
          duration_years: normalized.duration || 4,
          cluster_group: normalized.cluster_group || 1,
          career_field: normalized.career_field || null,
          admission_year: admissionYear,
          import_log_id: logId,
          is_active: true
        };

        const { data: existing } = await db.from('courses')
          .select('id').eq('programme_code', normalized.programme_code)
          .eq('admission_year', admissionYear).single();

        let courseId;
        if (existing) {
          await db.from('courses').update(courseData).eq('id', existing.id);
          courseId = existing.id;
          updated++;
        } else {
          const { data: created } = await db.from('courses').insert(courseData).select('id').single();
          courseId = created?.id;
          imported++;
        }

        if (!courseId) continue;

        // Upsert cut-off
        if (normalized.cutoff > 0) {
          await db.from('historical_cutoffs').upsert({
            course_id: courseId,
            admission_year: admissionYear,
            cutoff_points: normalized.cutoff,
            quota: normalized.quota || null,
            import_log_id: logId
          }, { onConflict: 'course_id,admission_year' });
        }

        // Parse and insert requirements
        if (normalized.subjects) {
          const reqs = this.parseSubjectRequirements(normalized.subjects);
          if (reqs.length) {
            // Delete old requirements
            await db.from('programme_requirements').delete().eq('course_id', courseId);
            // Insert new
            await db.from('programme_requirements').insert(
              reqs.map(r => ({ ...r, course_id: courseId }))
            );
          }
        }

      } catch (err) {
        logger.warn('Row import error', { error: err.message });
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    await db.from('import_logs').update({
      status: 'committed',
      rows_imported: imported,
      rows_updated: updated,
      duration_seconds: duration,
      completed_at: new Date().toISOString()
    }).eq('id', logId);

    logger.info('Import committed', { logId, imported, updated, duration });
    return { imported, updated, duration };
  }

  // ---- ROLLBACK IMPORT ----
  async rollbackImport(logId) {
    const db = getSupabaseAdmin();
    const { data: log } = await db.from('import_logs').select('*').eq('id', logId).single();
    if (!log || !log.can_rollback) throw new Error('Cannot rollback this import');

    // Delete all data from this import
    await db.from('historical_cutoffs').delete().eq('import_log_id', logId);
    await db.from('courses').delete().eq('import_log_id', logId);

    await db.from('import_logs').update({
      status: 'rolled_back', can_rollback: false
    }).eq('id', logId);

    logger.info('Import rolled back', { logId });
    return true;
  }
}

export default new ImportService();
