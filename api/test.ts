export default async function handler(req: any, res: any) {
  res.json({ 
    status: "API is reachable",
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasSheetsCreds: !!process.env.GOOGLE_SHEETS_CREDENTIALS,
    env: process.env.NODE_ENV
  });
}
