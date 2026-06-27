# Cymor KUCCPS Advisor — Backend API

Kenya's smartest KUCCPS admission advisor. Built with Node.js, Express, Supabase, IntaSend M-Pesa.

---

## Stack

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Runtime     | Node.js 18+ (ES Modules)          |
| Framework   | Express.js                        |
| Database    | Supabase PostgreSQL                |
| Storage     | Supabase Storage                  |
| Payments    | IntaSend M-Pesa STK Push          |
| PDF         | html-pdf-node                     |
| Auth        | JWT (admin only)                  |
| Hosting     | Render                            |

---

## Project Structure

```
src/
├── config/
│   └── database.js          Supabase client singleton
├── controllers/
│   ├── ReportController.js  Student-facing report endpoints
│   ├── WebhookController.js IntaSend payment webhook
│   └── AdminController.js   Admin dashboard endpoints
├── services/
│   ├── ClusterService.js    KUCCPS cluster point engine ⭐
│   ├── PaymentService.js    IntaSend M-Pesa integration
│   ├── ReportService.js     Report lifecycle management
│   ├── PdfService.js        PDF generation + upload
│   ├── AuthService.js       JWT + admin auth
│   └── ImportService.js     CSV/Excel data import
├── middleware/
│   ├── auth.js              JWT verification
│   ├── errorHandler.js      Global error handling
│   └── upload.js            Multer file upload
├── routes/
│   ├── report.routes.js     /api/v1/reports
│   ├── webhook.routes.js    /api/v1/webhooks
│   ├── admin.routes.js      /api/v1/admin (protected)
│   └── public.routes.js     /api/v1/public
├── utils/
│   ├── constants.js         Grades, subjects, cluster definitions
│   ├── logger.js            Winston logger
│   └── response.js          Consistent JSON responses
├── database/
│   └── migrations/
│       └── 001_schema.sql   Complete DB schema
└── server.js                Express app entry point

scripts/
├── migrate.js               Migration instructions
└── seed.js                  Sample data seeder
```

---

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor → New Query**
3. Paste contents of `src/database/migrations/001_schema.sql` and run
4. Go to **Storage** and create two buckets:
   - `kuccps-reports` — set to **Public**
   - `kuccps-imports` — set to **Private**
5. Copy your **Project URL**, **anon key**, and **service_role key**

### 2. IntaSend

1. Create account at [intasend.com](https://intasend.com)
2. Get your **Public Key** and **Secret Key**
3. Set webhook URL to: `https://your-api.onrender.com/api/v1/webhooks/intasend`

### 3. Environment

```bash
cp .env.example .env
# Fill in all values
```

### 4. Install & Run

```bash
npm install
npm run seed    # Seeds sample universities and courses
npm run dev     # Development with nodemon
npm start       # Production
```

---

## API Reference

### Student Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/reports/initiate` | Create report + initiate payment |
| GET | `/api/v1/reports/status/:merchantRef` | Poll payment + report status |
| GET | `/api/v1/reports/:reportCode` | Fetch completed report |
| POST | `/api/v1/reports/:reportCode/download` | Track PDF download |
| POST | `/api/v1/reports/validate-coupon` | Validate coupon code |
| POST | `/api/v1/reports/preview-grades` | Free mean grade preview |

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/public/announcements` | Active announcements |
| GET | `/api/v1/public/features` | Feature flag states |
| GET | `/api/v1/public/payment-info` | Current price + status |
| GET | `/api/v1/public/stats` | Platform statistics |

### Admin Endpoints (JWT Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/admin/login` | Admin login |
| GET | `/api/v1/admin/dashboard` | Dashboard statistics |
| GET | `/api/v1/admin/reports` | List all reports |
| GET | `/api/v1/admin/analytics` | Revenue + analytics |
| POST | `/api/v1/admin/imports/upload` | Upload CSV/Excel file |
| POST | `/api/v1/admin/imports/:logId/confirm` | Commit import |
| POST | `/api/v1/admin/imports/:logId/rollback` | Rollback import |
| GET/PUT | `/api/v1/admin/payment-settings` | Payment configuration |
| CRUD | `/api/v1/admin/coupons` | Coupon management |
| CRUD | `/api/v1/admin/giveaways` | Giveaway management |
| GET/PUT | `/api/v1/admin/features/:name` | Feature flag toggle |
| CRUD | `/api/v1/admin/announcements` | Announcements |
| GET/PUT | `/api/v1/admin/settings/:key` | System settings |

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/webhooks/intasend` | IntaSend payment callback |

---

## Initiate Report — Request Body

```json
{
  "studentName": "Jane Wanjiku Kamau",
  "phone": "0712345678",
  "email": "jane@example.com",
  "schoolName": "Alliance Girls High School",
  "kcseYear": 2024,
  "couponCode": "WELCOME50",
  "grades": {
    "Mathematics": "B+",
    "English": "A-",
    "Kiswahili": "B",
    "Biology": "A-",
    "Chemistry": "B+",
    "Physics": "B",
    "History & Government": "A",
    "Geography": "B+"
  }
}
```

---

## Deploying to Render

1. Push to GitHub
2. Create **New Web Service** on Render
3. Connect repository
4. Build: `npm install`
5. Start: `npm start`
6. Add all environment variables
7. Set IntaSend webhook to your Render URL

---

## KUCCPS Cluster Engine

The cluster calculation engine in `ClusterService.js` implements:

- Grade point mapping (E=1 through A=12)
- Mean grade calculation
- Cluster group subject selection (5 cluster groups)
- Programme requirement validation
- Admission chance rating (Very Strong / Strong / Competitive / Possible / Unlikely)
- Historical trend analysis (Increasing / Stable / Decreasing)
- Recommendation ranking (1A through 4)

Update cluster groups and weights in `src/utils/constants.js` each admission cycle.

---

Built by Cymor Tech Services — Always a Winner. 🏆
