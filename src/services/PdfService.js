// src/services/PdfService.js
import htmlPdf from 'html-pdf-node';
import { getSupabaseAdmin } from '../config/database.js';
import logger from '../utils/logger.js';

class PdfService {

  // ---- GRADE COLOUR ----
  _gradeColor(grade) {
    if (['A','A-'].includes(grade))   return '#22C55E';
    if (['B+','B','B-'].includes(grade)) return '#06B6D4';
    if (['C+','C','C-'].includes(grade)) return '#F59E0B';
    return '#EF4444';
  }

  _chanceColor(chance) {
    const map = {
      'Very Strong': '#22C55E', 'Strong': '#22C55E',
      'Competitive': '#F59E0B', 'Possible': '#06B6D4', 'Unlikely': '#EF4444'
    };
    return map[chance] || '#94A3B8';
  }

  _trendArrow(trend) {
    if (trend === 'increasing') return '↑';
    if (trend === 'decreasing') return '↓';
    return '→';
  }

  // ---- BUILD SUBJECT ROWS ----
  _buildSubjectRows(grades) {
    return Object.entries(grades).map(([subject, grade]) => `
      <tr>
        <td>${subject}</td>
        <td style="color:${this._gradeColor(grade)};font-weight:700">${grade}</td>
      </tr>
    `).join('');
  }

  // ---- BUILD COURSE ROWS ----
  _buildCourseRows(courses) {
    return courses.slice(0, 50).map((rc, idx) => {
      const course = rc.courses;
      const uni = course?.universities;
      const diff = rc.cutoff_diff;
      const diffStr = diff !== null
        ? `<span style="color:${diff >= 0 ? '#22C55E' : '#EF4444'}">${diff >= 0 ? '+' : ''}${diff}</span>`
        : 'N/A';

      return `
        <tr>
          <td style="font-weight:600;color:#4F46E5">${rc.recommendation || (idx + 1)}</td>
          <td style="color:#94A3B8;font-size:11px">${course?.programme_code || ''}</td>
          <td><strong>${course?.name || ''}</strong></td>
          <td>${uni?.name || ''}</td>
          <td>${uni?.county || ''}</td>
          <td style="font-weight:700">${rc.cluster_points}</td>
          <td>${rc.cutoff_points || 'N/A'}</td>
          <td>${diffStr}</td>
          <td>
            <span style="
              background:${this._chanceColor(rc.admission_chance)}22;
              color:${this._chanceColor(rc.admission_chance)};
              padding:3px 10px;border-radius:100px;font-size:11px;font-weight:700
            ">${rc.admission_chance}</span>
          </td>
          <td style="font-size:14px">${this._trendArrow(rc.trend)}</td>
        </tr>
      `;
    }).join('');
  }

  // ---- BUILD RECOMMENDATIONS SECTION ----
  _buildRecommendations(courses) {
    const top6 = courses.filter(c => c.recommendation).slice(0, 6);
    return top6.map(rc => {
      const course = rc.courses;
      const uni = course?.universities;
      return `
        <div style="
          background:#1E293B;border:1px solid rgba(255,255,255,0.08);
          border-left:4px solid ${this._chanceColor(rc.admission_chance)};
          border-radius:10px;padding:16px 20px;margin-bottom:12px
        ">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
            <div>
              <span style="
                background:#4F46E522;color:#6366F1;
                padding:3px 10px;border-radius:100px;font-size:11px;font-weight:700;
                margin-right:10px
              ">${rc.recommendation}</span>
              <strong style="font-size:15px;color:#F1F5F9">${course?.name || ''}</strong>
            </div>
            <span style="
              background:${this._chanceColor(rc.admission_chance)}22;
              color:${this._chanceColor(rc.admission_chance)};
              padding:4px 12px;border-radius:100px;font-size:11px;font-weight:700;
              white-space:nowrap
            ">${rc.admission_chance}</span>
          </div>
          <div style="color:#94A3B8;font-size:13px;margin-bottom:8px">
            ${uni?.name || ''} • ${uni?.county || ''} • ${course?.degree_type || ''}
            • Cluster: <strong style="color:#06B6D4">${rc.cluster_points}</strong>
            ${rc.cutoff_points ? `• Cut-off: <strong style="color:#F59E0B">${rc.cutoff_points}</strong>` : ''}
          </div>
          <div style="color:#64748B;font-size:12px;font-style:italic">${rc.reason || ''}</div>
        </div>
      `;
    }).join('');
  }

  // ---- FULL HTML TEMPLATE ----
  _buildHtml(report, analysis) {
    const reportCourses = report.report_courses || [];
    const now = new Date().toLocaleDateString('en-KE', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #0F172A;
      color: #F1F5F9;
      font-size: 13px;
      line-height: 1.5;
    }
    .page { padding: 0; }

    /* COVER */
    .cover {
      background: linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%);
      min-height: 297mm;
      display: flex;
      flex-direction: column;
      padding: 48px 48px 40px;
      position: relative;
      overflow: hidden;
      page-break-after: always;
    }
    .cover-orb-1 {
      position: absolute; top: -80px; right: -80px;
      width: 300px; height: 300px;
      background: radial-gradient(circle, rgba(79,70,229,0.3) 0%, transparent 70%);
      border-radius: 50%;
    }
    .cover-orb-2 {
      position: absolute; bottom: 60px; left: -60px;
      width: 220px; height: 220px;
      background: radial-gradient(circle, rgba(6,182,212,0.2) 0%, transparent 70%);
      border-radius: 50%;
    }
    .cover-logo {
      display: flex; align-items: center; gap: 12px; margin-bottom: 60px;
    }
    .logo-mark {
      width: 44px; height: 44px; background: #4F46E5; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 22px; font-weight: 800;
    }
    .logo-text { font-size: 18px; font-weight: 700; }
    .logo-text span { color: #06B6D4; }
    .cover-badge {
      display: inline-flex; align-items: center; gap: 8px;
      background: rgba(79,70,229,0.15); border: 1px solid rgba(79,70,229,0.3);
      border-radius: 100px; padding: 6px 16px; font-size: 12px;
      color: #818CF8; font-weight: 600; margin-bottom: 24px; width: fit-content;
    }
    .cover-title {
      font-size: 42px; font-weight: 800; line-height: 1.1;
      letter-spacing: -0.03em; margin-bottom: 12px;
    }
    .cover-title span { color: #06B6D4; }
    .cover-subtitle { color: #94A3B8; font-size: 16px; margin-bottom: 56px; }
    .cover-student-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px; padding: 28px 32px; margin-bottom: 40px;
    }
    .cover-student-card h3 {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em;
      color: #64748B; font-weight: 700; margin-bottom: 20px;
    }
    .student-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
    }
    .student-field label {
      display: block; font-size: 11px; color: #64748B; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;
    }
    .student-field span {
      font-size: 15px; font-weight: 600; color: #F1F5F9;
    }
    .cover-stats {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
    }
    .cover-stat {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 12px; padding: 20px; text-align: center;
    }
    .cover-stat .num {
      font-size: 32px; font-weight: 800; color: #4F46E5;
      display: block; line-height: 1;
    }
    .cover-stat .lbl {
      font-size: 12px; color: #64748B; margin-top: 6px; display: block;
    }
    .cover-footer {
      margin-top: auto; padding-top: 32px;
      border-top: 1px solid rgba(255,255,255,0.07);
      display: flex; justify-content: space-between; align-items: center;
    }
    .cover-footer p { font-size: 11px; color: #64748B; }
    .report-id {
      font-family: monospace; font-size: 13px; color: #4F46E5; font-weight: 700;
    }

    /* CONTENT PAGES */
    .content-page {
      padding: 40px 48px;
      page-break-after: always;
      min-height: 297mm;
    }
    .page-header {
      display: flex; justify-content: space-between; align-items: center;
      padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 32px;
    }
    .page-header .ph-title { font-size: 11px; color: #64748B; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
    .page-header .ph-code  { font-size: 11px; color: #4F46E5; font-family: monospace; }

    h2.section-title {
      font-size: 20px; font-weight: 700; margin-bottom: 20px;
      padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    h2.section-title span { color: #06B6D4; }

    /* GRADES TABLE */
    table { width: 100%; border-collapse: collapse; }
    table th {
      text-align: left; padding: 10px 14px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em;
      color: #64748B; font-weight: 700;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    table td {
      padding: 11px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      color: #CBD5E1;
    }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: rgba(255,255,255,0.02); }

    /* MEAN GRADE CARD */
    .mean-card {
      display: inline-flex; gap: 24px; margin-bottom: 28px;
    }
    .mean-item {
      background: rgba(79,70,229,0.12); border: 1px solid rgba(79,70,229,0.25);
      border-radius: 12px; padding: 16px 28px; text-align: center;
    }
    .mean-item .val { font-size: 36px; font-weight: 800; color: #818CF8; display: block; }
    .mean-item .lbl { font-size: 11px; color: #64748B; display: block; margin-top: 4px; }

    /* FOOTER */
    .pdf-footer {
      margin-top: auto; padding-top: 20px;
      border-top: 1px solid rgba(255,255,255,0.06);
      display: flex; justify-content: space-between;
      font-size: 10px; color: #475569;
    }

    @media print {
      .cover { page-break-after: always; }
      .content-page { page-break-after: always; }
    }
  </style>
</head>
<body>

<!-- ===== COVER PAGE ===== -->
<div class="cover">
  <div class="cover-orb-1"></div>
  <div class="cover-orb-2"></div>

  <div class="cover-logo">
    <div class="logo-mark">C</div>
    <div class="logo-text">Cymor <span>KUCCPS</span> Advisor</div>
  </div>

  <div class="cover-badge">
    <span style="width:7px;height:7px;background:#22C55E;border-radius:50%;display:inline-block"></span>
    ${report.kcse_year} Admission Cycle Report
  </div>

  <h1 class="cover-title">
    Your KUCCPS<br />
    <span>Admission Report</span>
  </h1>
  <p class="cover-subtitle">
    Cluster calculations, cut-off analysis, and ranked<br />recommendations for your KCSE results.
  </p>

  <div class="cover-student-card">
    <h3>Student Information</h3>
    <div class="student-grid">
      <div class="student-field">
        <label>Full Name</label>
        <span>${report.student_name}</span>
      </div>
      <div class="student-field">
        <label>KCSE Year</label>
        <span>${report.kcse_year}</span>
      </div>
      <div class="student-field">
        <label>Mean Grade</label>
        <span style="color:#22C55E;font-size:20px">${report.mean_grade}</span>
      </div>
      <div class="student-field">
        <label>Mean Points</label>
        <span style="color:#06B6D4">${report.mean_points}</span>
      </div>
      ${report.school_name ? `
      <div class="student-field">
        <label>School</label>
        <span>${report.school_name}</span>
      </div>` : ''}
    </div>
  </div>

  <div class="cover-stats">
    <div class="cover-stat">
      <span class="num">${analysis.totalQualifying}</span>
      <span class="lbl">Qualifying Programmes</span>
    </div>
    <div class="cover-stat">
      <span class="num" style="color:#06B6D4">${report.mean_grade}</span>
      <span class="lbl">Mean Grade</span>
    </div>
    <div class="cover-stat">
      <span class="num" style="color:#22C55E">6</span>
      <span class="lbl">Recommendations</span>
    </div>
  </div>

  <div class="cover-footer">
    <div>
      <p>Generated on ${now}</p>
      <p>Valid for 90 days from generation date</p>
    </div>
    <div class="report-id">${report.report_code}</div>
  </div>
</div>

<!-- ===== PAGE 2: GRADES & CLUSTERS ===== -->
<div class="content-page">
  <div class="page-header">
    <span class="ph-title">KCSE Subject Summary</span>
    <span class="ph-code">${report.report_code}</span>
  </div>

  <h2 class="section-title">Mean Grade & <span>Subject Scores</span></h2>

  <div class="mean-card">
    <div class="mean-item">
      <span class="val">${report.mean_grade}</span>
      <span class="lbl">Mean Grade</span>
    </div>
    <div class="mean-item" style="background:rgba(6,182,212,0.1);border-color:rgba(6,182,212,0.2)">
      <span class="val" style="color:#06B6D4">${report.mean_points}</span>
      <span class="lbl">Mean Points</span>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Subject</th><th>Grade</th></tr>
    </thead>
    <tbody>
      ${this._buildSubjectRows(report.grades)}
    </tbody>
  </table>

  <div class="pdf-footer">
    <span>Cymor KUCCPS Advisor — cymor.co.ke</span>
    <span>${report.report_code} • ${now}</span>
  </div>
</div>

<!-- ===== PAGE 3: RECOMMENDATIONS ===== -->
<div class="content-page">
  <div class="page-header">
    <span class="ph-title">Top Recommendations</span>
    <span class="ph-code">${report.report_code}</span>
  </div>

  <h2 class="section-title">Your Best <span>Application Order</span></h2>
  <p style="color:#64748B;margin-bottom:24px;font-size:13px">
    These programmes are ranked from safest to most competitive based on your cluster points and historical cut-off data.
    Apply in this order for the best chance of placement.
  </p>

  ${this._buildRecommendations(reportCourses)}

  <div class="pdf-footer">
    <span>Cymor KUCCPS Advisor — cymor.co.ke</span>
    <span>${report.report_code} • ${now}</span>
  </div>
</div>

<!-- ===== PAGE 4: FULL COURSES TABLE ===== -->
<div class="content-page" style="page-break-after:auto">
  <div class="page-header">
    <span class="ph-title">All Qualifying Programmes</span>
    <span class="ph-code">${report.report_code}</span>
  </div>

  <h2 class="section-title">Complete <span>Qualifying Programmes</span>
    <span style="font-size:14px;color:#64748B;font-weight:400;margin-left:12px">
      (${analysis.totalQualifying} programmes)
    </span>
  </h2>

  <table>
    <thead>
      <tr>
        <th>Rank</th>
        <th>Code</th>
        <th>Programme</th>
        <th>University</th>
        <th>County</th>
        <th>Cluster Pts</th>
        <th>Cut-off</th>
        <th>Diff</th>
        <th>Chance</th>
        <th>Trend</th>
      </tr>
    </thead>
    <tbody>
      ${this._buildCourseRows(reportCourses)}
    </tbody>
  </table>

  ${analysis.totalQualifying > 50 ? `
  <p style="color:#64748B;font-size:12px;margin-top:16px;font-style:italic">
    * Showing top 50 of ${analysis.totalQualifying} qualifying programmes. Full list available in the platform.
  </p>` : ''}

  <div class="pdf-footer">
    <span>Cymor KUCCPS Advisor — cymor.co.ke</span>
    <span>${report.report_code} • ${now} • KUCCPS data ${report.kcse_year}</span>
  </div>
</div>

</body>
</html>`;
  }

  // ---- GENERATE AND UPLOAD PDF ----
  async generateReportPdf(report, analysis) {
    try {
      const html = this._buildHtml(report, analysis);

      const options = {
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        displayHeaderFooter: false,
        preferCSSPageSize: true
      };

      const file = { content: html };
      const pdfBuffer = await htmlPdf.generatePdf(file, options);

      // Upload to Supabase Storage
      const db = getSupabaseAdmin();
      const fileName = `reports/${report.report_code}.pdf`;

      const { error: uploadError } = await db.storage
        .from('kuccps-reports')
        .upload(fileName, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (uploadError) {
        logger.warn('PDF upload failed, returning base64', { error: uploadError.message });
        // Fallback: return data URL
        return `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
      }

      const { data: urlData } = db.storage
        .from('kuccps-reports')
        .getPublicUrl(fileName);

      logger.info('PDF generated and uploaded', { reportCode: report.report_code, url: urlData.publicUrl });
      return urlData.publicUrl;

    } catch (err) {
      logger.error('PDF generation error', { error: err.message });
      throw new Error(`PDF generation failed: ${err.message}`);
    }
  }
}

export default new PdfService();
