# Risk SN Check

Static web version of the Android RiskSnScanner flow.

## Deploy on Vercel

1. Put the risk list at the project root as `Risk_SN.csv`.
2. Deploy this folder to Vercel.
3. Open the Vercel HTTPS URL on a camera-enabled device.

The app loads `Risk_SN.csv` automatically. The CSV can contain one SN per line or SN values in CSV cells. P-starting SN values are used for checks.

## Local preview

```bash
node server.mjs
```

Then open `http://localhost:4173`.
