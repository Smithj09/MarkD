
# OmniMarket Pro Documentation

## Architecture Overview
OmniMarket Pro is a scalable, multi-vendor e-commerce architecture designed for high availability and clean separation of concerns.

### Tech Stack
- **Frontend**: React 18, Tailwind CSS, Lucide Icons, Recharts.
- **Backend**: Node.js/Express, JWT, Helmet.
- **Database**: PostgreSQL (Relational integrity, complex queries).
- **Caching**: Redis (Optional for session storage and frequent product lookups).
- **AI**: Google Gemini 3 Flash for automated catalog enrichment.
- **Storage**: AWS S3 or Google Cloud Storage for media assets.

## Core Features
- **Authentication**: JWT-based session management with role-based access control (RBAC).
- **AI Enrichment**: Integrated Gemini API for vendor assistance (writing product descriptions).
- **Vendor Hub**: Comprehensive dashboard for sales analytics and inventory management.
- **Security**: 
  - Rate limiting to prevent brute force.
  - BCrypt for password hashing.
  - Helmet for secure HTTP headers.
  - PostgreSQL parameterized queries for SQL injection prevention.

## Deployment Instructions

### 1. Prerequisites
- Node.js 18+
- PostgreSQL Instance
- Stripe API Key (for payments)
- Gemini API Key (for AI features)

### 2. Environment Setup
Create a `.env` file in the root:
```env
PORT=4000
DATABASE_URL=postgres://user:password@localhost:5432/omnimarket
JWT_SECRET=your_long_random_secret
API_KEY=your_gemini_api_key
STRIPE_SECRET=your_stripe_secret
```

### 3. Running Locally
```bash
# Install dependencies
npm install

# Run frontend (Vite/React)
npm run dev

# Run backend
ts-node backend/server.ts
```

### 4. Docker Deployment
```yaml
# docker-compose.yml example
services:
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: omnimarket
  api:
    build: .
    ports: ["4000:4000"]
    depends_on: ["db"]
  frontend:
    build: ./frontend
    ports: ["80:80"]
```

## Future Enhancement Roadmap
1. **Live Support**: Integrate Gemini Live API for real-time customer voice assistance.
2. **Search Grounding**: Enhance search results with Google Search grounding for real-time market price comparisons.
3. **Advanced Personalization**: Use user browsing history and Gemini to generate custom "Daily Picks" sections.
4. **Mobile App**: Port frontend logic to React Native for iOS/Android coverage.
