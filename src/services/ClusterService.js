// src/services/ClusterService.js
// ============================================
// KUCCPS CLUSTER POINT ENGINE
// Implements the official KUCCPS methodology
// ============================================

import { GRADE_POINTS, ADMISSION_CHANCES, TREND } from '../utils/constants.js';
import { getSupabaseAdmin } from '../config/database.js';
import logger from '../utils/logger.js';

class ClusterService {

  // ---- GRADE TO POINTS ----
  gradeToPoints(grade) {
    if (!grade) return 0;
    const normalized = grade.toString().trim().toUpperCase()
      .replace('A-', 'A-').replace('B+', 'B+').replace('B-', 'B-')
      .replace('C+', 'C+').replace('C-', 'C-').replace('D+', 'D+')
      .replace('D-', 'D-');
    return GRADE_POINTS[normalized] ?? 0;
  }

  // ---- MEAN GRADE CALCULATION ----
  calculateMeanGrade(grades) {
    const subjects = Object.values(grades).filter(g => g && g !== '');
    if (!subjects.length) return { meanGrade: 'E', meanPoints: 0 };

    const points = subjects.map(g => this.gradeToPoints(g));
    const total = points.reduce((a, b) => a + b, 0);
    const mean = total / subjects.length;

    // Round to nearest 0.5 then map to grade
    const rounded = Math.round(mean * 2) / 2;
    const gradeMap = {
      12: 'A', 11.5: 'A', 11: 'A-', 10.5: 'A-',
      10: 'B+', 9.5: 'B+', 9: 'B', 8.5: 'B',
      8: 'B-', 7.5: 'B-', 7: 'C+', 6.5: 'C+',
      6: 'C', 5.5: 'C', 5: 'C-', 4.5: 'C-',
      4: 'D+', 3.5: 'D+', 3: 'D', 2.5: 'D',
      2: 'D-', 1.5: 'D-', 1: 'E', 0.5: 'E', 0: 'E'
    };

    const meanGrade = gradeMap[Math.min(12, Math.max(0, rounded))] || 'E';
    return { meanGrade, meanPoints: parseFloat(mean.toFixed(2)) };
  }

  // ---- CLUSTER POINT FORMULA ----
  // Official KUCCPS: (Sum of 4 subject points × cluster weight) / 48 × 12
  // Simplified: select best 4 subjects for the cluster, sum points, scale
  calculateClusterPoints(grades, clusterGroup) {
    const subjectPoints = this._getClusterSubjectPoints(grades, clusterGroup);
    if (!subjectPoints) return null;

    const rawSum = subjectPoints.reduce((a, b) => a + b.points, 0);
    // KUCCPS scales 4-subject sum (max 48) to 48-point scale
    const clusterPoints = parseFloat(((rawSum / 48) * 48).toFixed(2));
    return { clusterPoints, subjects: subjectPoints };
  }

  // ---- SELECT SUBJECTS FOR CLUSTER GROUP ----
  _getClusterSubjectPoints(grades, clusterGroup) {
    const g = grades; // shorthand

    const pt = (subject) => {
      const grade = g[subject];
      return grade ? this.gradeToPoints(grade) : 0;
    };

    const best = (...subjects) => {
      const pts = subjects.map(s => ({ subject: s, points: pt(s) }));
      return pts.sort((a, b) => b.points - a.points)[0];
    };

    const bestLang = () => {
      const eng = { subject: 'English', points: pt('English') };
      const kis = { subject: 'Kiswahili', points: pt('Kiswahili') };
      return eng.points >= kis.points ? eng : kis;
    };

    try {
      switch (clusterGroup) {
        case 1: // Sciences (Medicine, Pharmacy, Science)
          return [
            { subject: 'Mathematics', points: pt('Mathematics') },
            bestLang(),
            best('Biology', 'Physics'),
            { subject: 'Chemistry', points: pt('Chemistry') }
          ];

        case 2: // Biological Sciences (Agriculture, Vet, Nursing)
          return [
            { subject: 'Mathematics', points: pt('Mathematics') },
            bestLang(),
            { subject: 'Biology', points: pt('Biology') },
            best('Chemistry', 'Physics', 'Agriculture')
          ];

        case 3: // Physical Sciences (Engineering, Architecture)
          return [
            { subject: 'Mathematics', points: pt('Mathematics') },
            bestLang(),
            { subject: 'Physics', points: pt('Physics') },
            best('Chemistry', 'Mathematics', 'Geography')
          ];

        case 4: // Arts & Humanities (Law, Education, Arts)
          return [
            best('English', 'Kiswahili'),
            best('History & Government', 'Geography', 'CRE', 'IRE', 'HRE'),
            best('Mathematics', 'Biology', 'Chemistry', 'Physics', 'Agriculture'),
            best('Business Studies', 'Home Science', 'French', 'German', 'Music', 'Art & Design', 'Computer Studies')
          ];

        case 5: // Mathematics & Finance (Actuarial, Statistics, Economics)
          return [
            { subject: 'Mathematics', points: pt('Mathematics') },
            bestLang(),
            best('Physics', 'Chemistry', 'Biology'),
            best('Geography', 'Biology', 'Business Studies', 'Economics')
          ];

        default:
          // Generic: best 4 subjects
          return Object.entries(g)
            .filter(([_, v]) => v && v !== '')
            .map(([sub, grade]) => ({ subject: sub, points: this.gradeToPoints(grade) }))
            .sort((a, b) => b.points - a.points)
            .slice(0, 4);
      }
    } catch (err) {
      logger.error('Error selecting cluster subjects', { err, clusterGroup });
      return null;
    }
  }

  // ---- CHECK SUBJECT REQUIREMENTS ----
  checkRequirements(grades, requirements) {
    const missing = [];
    const met = [];

    // Group by requirement type
    const compulsory = requirements.filter(r => r.requirement_type === 'compulsory');
    const electives  = requirements.filter(r => r.requirement_type === 'elective_group');

    // Check compulsory subjects
    for (const req of compulsory) {
      const studentGrade = grades[req.subject_name];
      if (!studentGrade) {
        missing.push({ subject: req.subject_name, reason: 'Not taken', type: 'compulsory' });
        continue;
      }
      const studentPoints = this.gradeToPoints(studentGrade);
      const minPoints = this.gradeToPoints(req.min_grade);
      if (studentPoints < minPoints) {
        missing.push({
          subject: req.subject_name,
          reason: `Grade ${studentGrade} below required ${req.min_grade}`,
          type: 'compulsory'
        });
      } else {
        met.push({ subject: req.subject_name, grade: studentGrade });
      }
    }

    // Check elective groups
    const groupIds = [...new Set(electives.map(r => r.group_id))];
    for (const groupId of groupIds) {
      const groupReqs = electives.filter(r => r.group_id === groupId);
      const countRequired = groupReqs[0]?.count_required || 1;
      let countMet = 0;

      for (const req of groupReqs) {
        const studentGrade = grades[req.subject_name];
        if (studentGrade) {
          const studentPoints = this.gradeToPoints(studentGrade);
          const minPoints = this.gradeToPoints(req.min_grade);
          if (studentPoints >= minPoints) countMet++;
        }
      }

      if (countMet < countRequired) {
        const subjects = groupReqs.map(r => `${r.subject_name} (${r.min_grade}+)`).join(' or ');
        missing.push({
          subject: `Elective Group ${groupId}`,
          reason: `Need ${countRequired} of: ${subjects}`,
          type: 'elective'
        });
      }
    }

    return { qualifies: missing.length === 0, missing, met };
  }

  // ---- DETERMINE ADMISSION CHANCE ----
  getAdmissionChance(clusterPoints, cutoffPoints) {
    if (!cutoffPoints) return 'Competitive'; // No historical data
    const diff = clusterPoints - cutoffPoints;

    if (diff >= 3)       return 'Very Strong';
    if (diff >= 1)       return 'Strong';
    if (diff >= -1)      return 'Competitive';
    if (diff >= -3)      return 'Possible';
    return 'Unlikely';
  }

  // ---- HISTORICAL TREND ANALYSIS ----
  analyzeTrend(cutoffHistory) {
    if (!cutoffHistory || cutoffHistory.length < 2) return TREND.STABLE;

    const sorted = cutoffHistory
      .sort((a, b) => a.admission_year - b.admission_year)
      .map(c => c.cutoff_points);

    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const diff = last - prev;

    if (diff > 0.5)  return TREND.INCREASING;
    if (diff < -0.5) return TREND.DECREASING;
    return TREND.STABLE;
  }

  // ---- GENERATE RECOMMENDATIONS (1A-4 ranking) ----
  async generateRecommendations(qualifyingCourses) {
    // Sort by: admission chance strength, then cluster diff, then alphabetical
    const chanceOrder = { 'Very Strong': 0, 'Strong': 1, 'Competitive': 2, 'Possible': 3, 'Unlikely': 4 };
    const recommendationSlots = ['1A', '1B', '1C', '2', '3', '4'];

    const sorted = [...qualifyingCourses].sort((a, b) => {
      // Primary: prefer stable or decreasing trends (safer)
      const trendScore = (t) => t === TREND.DECREASING ? 0 : t === TREND.STABLE ? 1 : 2;
      // Secondary: admission chance
      const chanceA = chanceOrder[a.admission_chance] ?? 5;
      const chanceB = chanceOrder[b.admission_chance] ?? 5;
      if (chanceA !== chanceB) return chanceA - chanceB;
      // Tertiary: cluster diff (higher = safer)
      return (b.cutoff_diff || 0) - (a.cutoff_diff || 0);
    });

    return sorted.map((course, idx) => ({
      ...course,
      rank_position: idx + 1,
      recommendation: recommendationSlots[idx] || null,
      reason: this._generateReason(course, idx)
    }));
  }

  // ---- GENERATE RECOMMENDATION REASON ----
  _generateReason(course, rank) {
    const diff = course.cutoff_diff;
    const chance = course.admission_chance;
    const trend = course.trend;

    const courseName = course.course_name || 'This programme';
    const uni = course.university_name || 'this university';

    if (chance === 'Very Strong') {
      return `${courseName} at ${uni} is an excellent safe choice. Your cluster points are ${Math.abs(diff || 0).toFixed(1)} above the historical cut-off${trend === TREND.DECREASING ? ', and the cut-off has been falling — making entry even more likely' : ''}.`;
    }
    if (chance === 'Strong') {
      return `${courseName} is a strong match. You are above the cut-off and well-positioned for selection, provided you apply early.`;
    }
    if (chance === 'Competitive') {
      return `${courseName} is competitive — your points are very close to the cut-off. ${trend === TREND.INCREASING ? 'Note that this course is becoming more competitive year by year.' : 'This is a reasonable choice with a real chance of selection.'}`;
    }
    if (chance === 'Possible') {
      return `${courseName} is a stretch choice. You are slightly below the recent cut-off, but fluctuations between admission cycles mean selection is still possible.`;
    }
    return `${courseName} is below your current cluster range based on recent cut-offs. Consider as a last resort or if you have strong preference.`;
  }

  // ---- FULL ELIGIBILITY ANALYSIS ----
  async analyzeEligibility(grades, admissionYear = 2025) {
    const db = getSupabaseAdmin();

    // Calculate mean grade
    const { meanGrade, meanPoints } = this.calculateMeanGrade(grades);

    // Fetch all active courses with requirements and cut-offs
    const { data: courses, error } = await db
      .from('courses')
      .select(`
        id, name, programme_code, degree_type, duration_years,
        cluster_group, department, faculty, career_field,
        universities!inner(id, name, type, county, town),
        programme_requirements(subject_name, requirement_type, min_grade, group_id, count_required),
        historical_cutoffs(admission_year, cutoff_points)
      `)
      .eq('is_active', true)
      .eq('admission_year', admissionYear);

    if (error) throw new Error(`Failed to fetch courses: ${error.message}`);

    const qualifyingCourses = [];

    for (const course of courses) {
      // 1. Check subject requirements
      const reqCheck = this.checkRequirements(grades, course.programme_requirements || []);
      if (!reqCheck.qualifies) continue;

      // 2. Calculate cluster points
      const clusterResult = this.calculateClusterPoints(grades, course.cluster_group);
      if (!clusterResult) continue;

      const { clusterPoints } = clusterResult;

      // 3. Get latest cut-off and trend
      const cutoffs = (course.historical_cutoffs || []).sort(
        (a, b) => b.admission_year - a.admission_year
      );
      const latestCutoff = cutoffs[0]?.cutoff_points || null;
      const cutoffDiff = latestCutoff ? parseFloat((clusterPoints - latestCutoff).toFixed(2)) : null;

      // 4. Admission chance
      const admissionChance = this.getAdmissionChance(clusterPoints, latestCutoff);

      // 5. Historical trend
      const trend = this.analyzeTrend(cutoffs);

      qualifyingCourses.push({
        course_id:       course.id,
        course_name:     course.name,
        programme_code:  course.programme_code,
        degree_type:     course.degree_type,
        duration_years:  course.duration_years,
        cluster_group:   course.cluster_group,
        career_field:    course.career_field,
        university_id:   course.universities.id,
        university_name: course.universities.name,
        university_type: course.universities.type,
        county:          course.universities.county,
        cluster_points:  parseFloat(clusterPoints.toFixed(2)),
        cutoff_points:   latestCutoff,
        cutoff_diff:     cutoffDiff,
        admission_chance: admissionChance,
        trend,
        cutoff_history:  cutoffs.slice(0, 7).map(c => ({
          year: c.admission_year,
          cutoff: c.cutoff_points
        }))
      });
    }

    // Sort and generate recommendations
    const withRecommendations = await this.generateRecommendations(qualifyingCourses);

    logger.info('Eligibility analysis complete', {
      totalCourses: courses.length,
      qualifying: qualifyingCourses.length,
      meanGrade
    });

    return {
      meanGrade,
      meanPoints,
      totalQualifying: qualifyingCourses.length,
      courses: withRecommendations
    };
  }
}

export default new ClusterService();
