import { PDFParse } from "pdf-parse";
import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
const upload = multer({ storage: multer.memoryStorage() });

// Middleware para rodar multer em serverless
function runMiddleware(req: any, res: any, fn: any) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result: any) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

export default async function handler(req: any, res: any) {
  // Teste rápido de ambiente
  if (req.url === '/api/convert/test') {
    return res.json({ 
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasSheetsCreds: !!process.env.GOOGLE_SHEETS_CREDENTIALS,
      env: process.env.NODE_ENV
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Rodar Multer
    await runMiddleware(req, res, upload.single("pdf"));
    
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo PDF enviado" });
    }

    // 2. Parse PDF (Limitado a 2 páginas para teste)
    const parser = new PDFParse({ 
      data: req.file.buffer,
      pagerrender: (pageNumber: number) => pageNumber <= 2 
    });
    const pdfData = await parser.getText();
    
    // 3. Setup Google Sheets Auth
    const credsEnv = process.env.GOOGLE_SHEETS_CREDENTIALS;
    if (!credsEnv) throw new Error("GOOGLE_SHEETS_CREDENTIALS faltando.");
    const credentials = JSON.parse(credsEnv.trim().replace(/\\n/g, '\n'));

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheetsClient = google.sheets({ version: "v4", auth });

    // 4. Criar e Compartilhar
    const spreadsheet = await sheetsClient.spreadsheets.create({
      requestBody: { properties: { title: req.file.originalname } },
    });
    const spreadsheetId = spreadsheet.data.spreadsheetId;

    await sheetsClient.permissions.create({
      spreadsheetId: spreadsheetId!,
      requestBody: {
        type: 'user',
        role: 'writer',
        emailAddress: 'webluciano.soares@gmail.com',
      },
    });

    // 5. Extrair com Gemini
    const prompt = `Extraia apenas a tabela principal como JSON array de arrays: ${pdfData.text.substring(0, 20000)}`;
    const result = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    
    let jsonString = result.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    jsonString = jsonString.replace(/```json|```/g, "").trim();
    const rows = JSON.parse(jsonString);

    // 6. Escrever
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: spreadsheetId!,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
    
    res.json({ spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message, detail: error.toString() });
  }
}

// Configuração importante para Vercel não tentar dar parse no body antes do multer
export const config = {
  api: {
    bodyParser: false,
  },
};
