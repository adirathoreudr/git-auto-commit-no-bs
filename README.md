# Git Auto-Commit (No BS) 🤖

An autonomous AI agent that automatically scans your GitHub repositories and generates intelligent, context-aware code commits every single day. Powered by DeepSeek via NVIDIA NIM and perfectly automated via Vercel Cron.

🌐 **Live Demo:** [https://git-auto-commit-no-bs.vercel.app](https://git-auto-commit-no-bs.vercel.app)

---

## ⚡ TL;DR

1. **Deploy** to Vercel and attach a **Neon Postgres** database.
2. Set your `DATABASE_URL` and push the schema using `npx prisma db push`.
3. Open your live app, input your **DeepSeek API Key**, grab your free DeepSeek-V4-Flash API key from [NVIDIA NIM](https://build.nvidia.com/deepseek-ai/deepseek-v4-flash) and plug it into the dashboard & **GitHub Token** in the Settings UI.
4. Add repositories and set a daily commit limit.
5. *Magic.* The app automatically pushes high-quality AI commits to your repos every day!

---

## 🚀 Features

- **Autonomous AI Commits**: Automatically modifies, refactors, or adds comments to your codebase using DeepSeek.
- **Smart GitHub Integration**: Directly fetches, analyzes, and pushes unified diffs to your `main` branch.
- **Set It & Forget It**: Runs silently in the background once a day using Vercel Cron.
- **Secure Key Storage**: API keys are saved securely in your Postgres database, never in your code or public environment variables.
- **Beautiful Dashboard**: A slick, modern Next.js interface to track your automated commit activity in real-time.

---

## 🛠️ Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Database:** PostgreSQL (Neon Serverless)
- **ORM:** Prisma 7 (`@prisma/adapter-pg`)
- **Automation:** Vercel Cron Jobs
- **AI Model:** DeepSeek (via NVIDIA NIM)
- **Styling:** Tailwind CSS v4

---

## 💻 Local Development

Want to run this locally? Here is how to get started:

### 1. Clone the repository
```bash
git clone https://github.com/adirathoreudr/git-auto-commit-no-bs.git
cd git-auto-commit-no-bs/repo-agent
```

### 2. Install dependencies
```bash
npm install
```

### 3. Setup your environment variables
Create a `.env` file in the `repo-agent` directory and add your Postgres database URL:
```env
DATABASE_URL="postgres://username:password@hostname/dbname"
```

### 4. Initialize the Database
Push the Prisma schema to your database to create the necessary tables:
```bash
npx prisma db push
```

### 5. Start the App
```bash
npm run dev
```
Open `http://localhost:3000` in your browser. Configure your API keys in the Settings panel and start automating!

---

## 🌍 Production Deployment (Vercel)

1. Click **Import Project** on Vercel and select your GitHub repository.
2. Change the **Root Directory** to `repo-agent` in the build settings.
3. Once deployed, navigate to the **Storage** tab and attach a **Neon Postgres** database.
4. Copy the connection string (`DATABASE_URL`), paste it in your local `.env`, and run `npx prisma db push` to initialize the production database.
5. Enjoy your fully automated AI developer!
