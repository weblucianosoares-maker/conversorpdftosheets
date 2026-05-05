import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
const upload = multer({ storage: multer.memoryStorage() });

function runMiddleware(req: any, res: any, fn: any) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result: any) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await runMiddleware(req, res, upload.single("pdf"));
    if (!req.file) throw new Error("PDF não recebido.");

    // 1. Extração de texto ultra-leve usando PDF.js diretamente (sem canvas)
    let fullText = "";
    try {
      const data = new Uint8Array(req.file.buffer);
      const loadingTask = pdfjs.getDocument({
        data,
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true
      });
      const pdf = await loadingTask.promise;
      
      // Lemos apenas as 5 primeiras páginas para garantir que não dê timeout
      const maxPages = Math.min(pdf.numPages, 5);
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map((item: any) => item.str);
        fullText += strings.join(" ") + "\n";
      }
      console.log("Texto extraído com PDF.js. Tamanho:", fullText.length);
    } catch (e: any) {
      console.error("Erro no PDF.js:", e);
      throw new Error("Erro ao processar a leitura do PDF.");
    }

    // 2. Setup Google
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS!.trim().replace(/\\n/g, '\n'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheetsClient = google.sheets({ version: "v4", auth });

    // 3. Criar Planilha
    const spreadsheet = await sheetsClient.spreadsheets.create({
      requestBody: { properties: { title: `Convertido: ${req.file.originalname}` } },
    });
    const spreadsheetId = spreadsheet.data.spreadsheetId;

    // 4. Gemini AI - Extração de Tabela
    const prompt = `Extraia a tabela de usuários como um array JSON de arrays. Cabeçalhos: Marca Ótica, Empresa, Beneficiário, Idade, Tipo Beneficiário, Custo Médico, Qtde de Eventos, % Custo s/ Total, Custo Unitário. Texto: ${fullText.substring(0, 10000)}`;

    const result = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    
    let jsonString = result.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    jsonString = jsonString.replace(/```json|```/g, "").trim();
    const rows = JSON.parse(jsonString);

    // 5. Salvar e Compartilhar
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: spreadsheetId!,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });

    await sheetsClient.permissions.create({
      spreadsheetId: spreadsheetId!,
      requestBody: {
        type: 'user',
        role: 'writer',
        emailAddress: 'webluciano.soares@gmail.com',
      },
    });

    res.json({ spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` });

  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}

export const config = {
  api: { bodyParser: false },
};
