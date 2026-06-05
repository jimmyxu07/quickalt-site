# QuickAlt — Deployment Guide

This static site is ready to deploy to **GitHub Pages**.

## Files included

- `index.html` — Home / tool page
- `about.html` — About page
- `privacy.html` — Privacy Policy
- `terms.html` — Terms of Service
- `CNAME` — Custom domain (`quickalt.site`)
- `sitemap.xml` — Sitemap for search engines
- `robots.txt` — Robots instructions
- `assets/og-image.svg` — OG image placeholder
- `DEPLOY.md` — This file

## Deploy to GitHub Pages

### 1. Create a GitHub repository

Go to https://github.com/new and create a public repository, for example `quickalt-site`.

### 2. Push this folder to the repository

Open a terminal in `projects/quickalt-site/` and run:

```bash
cd /Users/leyantech/projects/quickalt-site
git init
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/quickalt-site.git
git add .
git commit -m "Initial QuickAlt static site"
git push -u origin main
```

### 3. Enable GitHub Pages

1. Go to your repository on GitHub.
2. Open **Settings > Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Choose the `main` branch and the `/(root)` folder.
5. Click **Save**.

### 4. Configure custom domain

1. Still in **Settings > Pages**, under **Custom domain**, enter `quickalt.site`.
2. Click **Save**.
3. GitHub will create a DNS check. Ensure your DNS provider points the domain to GitHub Pages:
   - For an apex domain (`quickalt.site`), create `A` records pointing to:
     - `185.199.108.153`
     - `185.199.109.153`
     - `185.199.110.153`
     - `185.199.111.153`
   - For a `www` subdomain, create a `CNAME` record pointing to `YOUR_USERNAME.github.io`.
4. The `CNAME` file in this repo already contains `quickalt.site` so GitHub Pages will preserve the custom domain on each deploy.

### 5. Verify

After a few minutes, visit https://quickalt.site/ to confirm the site is live.

### 6. Search Console (optional)

Submit the sitemap to Google Search Console:

```
https://quickalt.site/sitemap.xml
```

## Notes

- The site uses **Tailwind CSS via CDN** for fast iteration. For production at scale, consider switching to a built CSS bundle.
- AI generation is currently mocked via `setTimeout`. To integrate a real multimodal API, update the `generateMockAltText()` function in `index.html`.
- Plausible analytics are included (`data-domain="quickalt.site"`). Create a Plausible account and add your domain to start collecting stats.
- Replace `assets/og-image.svg` with a 1200×630 PNG for optimal social sharing on all platforms.
