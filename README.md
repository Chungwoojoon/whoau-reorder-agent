# WHO.A.U Reorder Agent

Static dashboard for WHO.A.U reorder recommendations.

## Run Locally

Open `index.html` in a browser.

## Deploy To Vercel

This is a static site. In Vercel, import the GitHub repository and keep the build command empty.

- Framework Preset: Other
- Build Command: empty
- Output Directory: `.`

## Data Sources

- `data/app-data.js`: generated reorder recommendation data
- `data/image-map.js`: WHO.A.U product image mapping

Regenerate data with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate-data.ps1
```
