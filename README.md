# IELTS API - Fastify Backend

Backend API cho IELTS Learning Platform sử dụng Fastify + Prisma + MySQL.

## 🚀 Quick Start

### 1. Requirements

- Node.js 18+
- MySQL 8.0+

### 2. Installation

```bash
npm install
cp .env.example .env
# Edit .env với MySQL connection string
```

### 3. Database Setup

```bash
# Tạo database trong MySQL
mysql -u root -p -e "CREATE DATABASE ielts_db;"

# Push schema
npm run db:push

# Seed sample data
npm run db:seed
```

### 4. Run Server

```bash
npm run dev
```

Server: **http://localhost:3000/api/v1**

---

## 📚 API Endpoints

### Auth

```
POST /auth/register  - Register
POST /auth/login     - Login
GET  /auth/me        - Current user
PUT  /auth/profile   - Update profile
```

### Courses

```
GET    /courses      - List (paginated)
GET    /courses/:id  - Get by ID
POST   /courses      - Create (admin/teacher)
PUT    /courses/:id  - Update
DELETE /courses/:id  - Delete (admin)
```

### Exams

```
GET    /exams        - List
GET    /exams/:id    - Get with sections
POST   /exams        - Create
PUT    /exams/:id    - Update
```

### Submissions

```
GET    /submissions        - List
POST   /submissions        - Start exam
PUT    /submissions/:id    - Save/Submit answers
POST   /submissions/:id/grade - Grade (admin/teacher)
```

---

## 🔐 Authentication

```
Authorization: Bearer <token>
```

---

## 📝 Test Accounts (after seeding)

| Role    | Email             | Password   |
| ------- | ----------------- | ---------- |
| Admin   | admin@ielts.com   | admin123   |
| Teacher | teacher@ielts.com | teacher123 |
| Student | student@ielts.com | student123 |

---

## 🛠️ Scripts

```bash
npm run dev          # Dev server
npm run db:push      # Push schema
npm run db:seed      # Seed data
npm run db:studio    # Prisma Studio
```
