# Deployment Checklist for GitHub & Vercel

## Pre-Deployment Security Check ✅

- [x] All API keys use environment variables (no hardcoded secrets)
- [x] `.env*` files are in `.gitignore`
- [x] `.env.example` created as template
- [x] Error messages don't expose sensitive information
- [x] Stripe webhook signature verification implemented
- [x] Firebase config uses environment variables

## Before Pushing to GitHub

1. **Verify no secrets in code:**
   ```bash
   # Check for any hardcoded API keys
   grep -r "sk_live\|sk_test\|AIza" src/ --exclude-dir=node_modules
   ```

2. **Ensure .gitignore is up to date:**
   - `.env*` files are ignored
   - `node_modules/` is ignored
   - `.next/` is ignored
   - `.vercel/` is ignored

3. **Test locally:**
   ```bash
   npm run build
   npm start
   ```

## GitHub Setup

1. **Create repository** (if not exists)
2. **Push code:**
   ```bash
   git add .
   git commit -m "Initial commit - SeaBob Center booking system"
   git push origin main
   ```

## Vercel Deployment

1. **Import project:**
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New Project"
   - Import from GitHub

2. **Configure Environment Variables:**
   In Vercel Dashboard → Project Settings → Environment Variables, add all variables from `.env.example`

3. **Deploy:**
   - Click "Deploy"
   - Wait for build to complete

4. **Set up Stripe Webhook:**
   - After deployment, copy your Vercel URL
   - Go to Stripe Dashboard → Developers → Webhooks
   - Add endpoint: `https://your-app.vercel.app/api/stripe/webhook`
   - Select event: `checkout.session.completed`
   - Copy the webhook signing secret
   - Add it to Vercel environment variables as `STRIPE_WEBHOOK_SECRET`
   - Redeploy to apply the new environment variable

## Post-Deployment

1. **Test authentication**
2. **Test payment flow**
3. **Review Firebase security rules**

## Security Best Practices

✅ **Implemented:**
- Environment variables for all secrets
- Webhook signature verification
- Secure password generation
- Error messages don't leak sensitive info

⚠️ **Remember:**
- Never commit `.env.local`
- Rotate API keys regularly
- Use different keys for dev/prod
