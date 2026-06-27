// scripts/seed.js
// Seeds sample KUCCPS data for development/testing
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const UNIVERSITIES = [
  { name: 'University of Nairobi', short_name: 'UoN', type: 'Public', county: 'Nairobi', town: 'Nairobi' },
  { name: 'Kenyatta University', short_name: 'KU', type: 'Public', county: 'Nairobi', town: 'Nairobi' },
  { name: 'Moi University', short_name: 'MU', type: 'Public', county: 'Uasin Gishu', town: 'Eldoret' },
  { name: 'Egerton University', short_name: 'EU', type: 'Public', county: 'Nakuru', town: 'Njoro' },
  { name: 'Jomo Kenyatta University of Agriculture and Technology', short_name: 'JKUAT', type: 'Public', county: 'Kiambu', town: 'Juja' },
  { name: 'Strathmore University', short_name: 'SU', type: 'Private', county: 'Nairobi', town: 'Nairobi' },
  { name: 'United States International University Africa', short_name: 'USIU', type: 'Private', county: 'Nairobi', town: 'Nairobi' },
  { name: 'Maseno University', short_name: 'MSU', type: 'Public', county: 'Kisumu', town: 'Maseno' },
  { name: 'Dedan Kimathi University', short_name: 'DeKUT', type: 'Public', county: 'Nyeri', town: 'Nyeri' },
  { name: 'Technical University of Kenya', short_name: 'TUK', type: 'Public', county: 'Nairobi', town: 'Nairobi' },
];

const SAMPLE_COURSES = [
  // UoN
  { name: 'Bachelor of Medicine & Surgery (MBChB)', programme_code: 'N01', degree_type: 'Degree', cluster_group: 1, duration_years: 6, career_field: 'Medicine', cutoff: 44.0, uni: 'University of Nairobi' },
  { name: 'Bachelor of Science (Computer Science)', programme_code: 'N02', degree_type: 'Degree', cluster_group: 3, duration_years: 4, career_field: 'Technology', cutoff: 38.5, uni: 'University of Nairobi' },
  { name: 'Bachelor of Laws (LLB)', programme_code: 'N03', degree_type: 'Degree', cluster_group: 4, duration_years: 4, career_field: 'Law', cutoff: 42.0, uni: 'University of Nairobi' },
  { name: 'Bachelor of Science (Nursing)', programme_code: 'N04', degree_type: 'Degree', cluster_group: 2, duration_years: 4, career_field: 'Health', cutoff: 35.0, uni: 'University of Nairobi' },
  { name: 'Bachelor of Engineering (Civil)', programme_code: 'N05', degree_type: 'Degree', cluster_group: 3, duration_years: 5, career_field: 'Engineering', cutoff: 40.0, uni: 'University of Nairobi' },
  { name: 'Bachelor of Commerce (Finance)', programme_code: 'N06', degree_type: 'Degree', cluster_group: 5, duration_years: 4, career_field: 'Finance', cutoff: 32.0, uni: 'University of Nairobi' },
  // KU
  { name: 'Bachelor of Education (Arts)', programme_code: 'K01', degree_type: 'Degree', cluster_group: 4, duration_years: 4, career_field: 'Education', cutoff: 28.0, uni: 'Kenyatta University' },
  { name: 'Bachelor of Science (Computer Science)', programme_code: 'K02', degree_type: 'Degree', cluster_group: 3, duration_years: 4, career_field: 'Technology', cutoff: 35.0, uni: 'Kenyatta University' },
  { name: 'Bachelor of Science (Mathematics)', programme_code: 'K03', degree_type: 'Degree', cluster_group: 5, duration_years: 4, career_field: 'Mathematics', cutoff: 30.0, uni: 'Kenyatta University' },
  // JKUAT
  { name: 'Bachelor of Science (Computer Science)', programme_code: 'J01', degree_type: 'Degree', cluster_group: 3, duration_years: 4, career_field: 'Technology', cutoff: 36.0, uni: 'Jomo Kenyatta University of Agriculture and Technology' },
  { name: 'Bachelor of Engineering (Electrical & Electronic)', programme_code: 'J02', degree_type: 'Degree', cluster_group: 3, duration_years: 5, career_field: 'Engineering', cutoff: 38.0, uni: 'Jomo Kenyatta University of Agriculture and Technology' },
  { name: 'Bachelor of Science (Agriculture)', programme_code: 'J03', degree_type: 'Degree', cluster_group: 2, duration_years: 4, career_field: 'Agriculture', cutoff: 26.0, uni: 'Jomo Kenyatta University of Agriculture and Technology' },
  // Strathmore
  { name: 'Bachelor of Science (Actuarial Science)', programme_code: 'S01', degree_type: 'Degree', cluster_group: 5, duration_years: 4, career_field: 'Finance', cutoff: 41.0, uni: 'Strathmore University' },
  { name: 'Bachelor of Commerce (Accounting)', programme_code: 'S02', degree_type: 'Degree', cluster_group: 5, duration_years: 4, career_field: 'Finance', cutoff: 35.0, uni: 'Strathmore University' },
  // Moi
  { name: 'Bachelor of Medicine & Surgery (MBChB)', programme_code: 'M01', degree_type: 'Degree', cluster_group: 1, duration_years: 6, career_field: 'Medicine', cutoff: 42.0, uni: 'Moi University' },
  { name: 'Bachelor of Science (Computer Science)', programme_code: 'M02', degree_type: 'Degree', cluster_group: 3, duration_years: 4, career_field: 'Technology', cutoff: 33.0, uni: 'Moi University' },
  { name: 'Bachelor of Education (Science)', programme_code: 'M03', degree_type: 'Degree', cluster_group: 3, duration_years: 4, career_field: 'Education', cutoff: 27.0, uni: 'Moi University' },
  // Maseno
  { name: 'Bachelor of Science (Computer Science)', programme_code: 'MS01', degree_type: 'Degree', cluster_group: 3, duration_years: 4, career_field: 'Technology', cutoff: 30.0, uni: 'Maseno University' },
  { name: 'Bachelor of Arts (Economics)', programme_code: 'MS02', degree_type: 'Degree', cluster_group: 4, duration_years: 4, career_field: 'Economics', cutoff: 25.0, uni: 'Maseno University' },
];

// Historical cut-off data (3 years per course)
const CUTOFF_HISTORY = {
  'N01': [{ year: 2022, cutoff: 43.5 }, { year: 2023, cutoff: 43.8 }],
  'N02': [{ year: 2022, cutoff: 37.8 }, { year: 2023, cutoff: 38.2 }],
  'N03': [{ year: 2022, cutoff: 41.5 }, { year: 2023, cutoff: 41.8 }],
  'N04': [{ year: 2022, cutoff: 34.0 }, { year: 2023, cutoff: 34.5 }],
  'N05': [{ year: 2022, cutoff: 39.2 }, { year: 2023, cutoff: 39.8 }],
  'J02': [{ year: 2022, cutoff: 37.2 }, { year: 2023, cutoff: 37.8 }],
  'S01': [{ year: 2022, cutoff: 40.0 }, { year: 2023, cutoff: 40.8 }],
};

// Subject requirements per cluster group
const REQUIREMENTS = {
  1: [ // Sciences
    { requirement_type: 'compulsory', subject_name: 'Mathematics', min_grade: 'B+', group_id: 0, count_required: 1 },
    { requirement_type: 'compulsory', subject_name: 'Chemistry', min_grade: 'B+', group_id: 0, count_required: 1 },
    { requirement_type: 'compulsory', subject_name: 'Biology', min_grade: 'B', group_id: 0, count_required: 1 },
  ],
  2: [ // Biological Sciences
    { requirement_type: 'compulsory', subject_name: 'Biology', min_grade: 'C+', group_id: 0, count_required: 1 },
    { requirement_type: 'compulsory', subject_name: 'Chemistry', min_grade: 'C+', group_id: 0, count_required: 1 },
  ],
  3: [ // Physical Sciences
    { requirement_type: 'compulsory', subject_name: 'Mathematics', min_grade: 'C+', group_id: 0, count_required: 1 },
    { requirement_type: 'compulsory', subject_name: 'Physics', min_grade: 'C+', group_id: 0, count_required: 1 },
  ],
  4: [ // Arts
    { requirement_type: 'compulsory', subject_name: 'English', min_grade: 'C+', group_id: 0, count_required: 1 },
  ],
  5: [ // Maths & Finance
    { requirement_type: 'compulsory', subject_name: 'Mathematics', min_grade: 'B+', group_id: 0, count_required: 1 },
  ]
};

async function seed() {
  console.log('🌱 Seeding sample data...\n');

  // 1. Universities
  console.log('Inserting universities...');
  const { data: unis, error: uniErr } = await db.from('universities')
    .upsert(UNIVERSITIES, { onConflict: 'name', ignoreDuplicates: true })
    .select();
  if (uniErr) { console.error('University seed error:', uniErr.message); }
  else console.log(`  ✓ ${unis?.length || UNIVERSITIES.length} universities`);

  // Map name → id
  const { data: allUnis } = await db.from('universities').select('id, name');
  const uniMap = {};
  allUnis?.forEach(u => { uniMap[u.name] = u.id; });

  // 2. Courses + requirements + cut-offs
  console.log('Inserting courses...');
  let courseCount = 0;

  for (const course of SAMPLE_COURSES) {
    const university_id = uniMap[course.uni];
    if (!university_id) { console.warn(`  ⚠ University not found: ${course.uni}`); continue; }

    const { data: existing } = await db.from('courses')
      .select('id').eq('programme_code', course.programme_code).eq('admission_year', 2024).single();

    let courseId;
    if (existing) {
      courseId = existing.id;
    } else {
      const { data: created, error } = await db.from('courses').insert({
        university_id,
        name:           course.name,
        programme_code: course.programme_code,
        degree_type:    course.degree_type,
        cluster_group:  course.cluster_group,
        duration_years: course.duration_years,
        career_field:   course.career_field,
        admission_year: 2024,
        is_active:      true
      }).select('id').single();

      if (error) { console.warn(`  ⚠ Course error (${course.programme_code}): ${error.message}`); continue; }
      courseId = created.id;
      courseCount++;
    }

    // Current year cut-off
    await db.from('historical_cutoffs').upsert({
      course_id:      courseId,
      admission_year: 2024,
      cutoff_points:  course.cutoff
    }, { onConflict: 'course_id,admission_year' });

    // Historical cut-offs
    const history = CUTOFF_HISTORY[course.programme_code] || [];
    for (const h of history) {
      await db.from('historical_cutoffs').upsert({
        course_id:      courseId,
        admission_year: h.year,
        cutoff_points:  h.cutoff
      }, { onConflict: 'course_id,admission_year' });
    }

    // Requirements
    const reqs = REQUIREMENTS[course.cluster_group] || [];
    if (reqs.length) {
      await db.from('programme_requirements').delete().eq('course_id', courseId);
      await db.from('programme_requirements').insert(
        reqs.map(r => ({ ...r, course_id: courseId }))
      );
    }
  }

  console.log(`  ✓ ${courseCount} new courses inserted`);

  console.log('\n✅ Seed complete!');
  console.log('\nNext steps:');
  console.log('  1. Ensure .env is configured');
  console.log('  2. npm run dev');
  console.log('  3. Visit http://localhost:5000/health');
}

seed().catch(console.error);
