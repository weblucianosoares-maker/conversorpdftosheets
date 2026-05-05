import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import { PDFParse } from "pdf-parse";

// Configurações globais
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
const upload = multer({ storage: multer.memoryStorage() });

// Helper para rodar middleware Express em Vercel
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
    // 1. Receber o arquivo
    await runMiddleware(req, res, upload.single("pdf"));
    if (!req.file) throw new Error("Nenhum arquivo PDF recebido.");

    console.log("Arquivo recebido:", req.file.originalname, req.file.size, "bytes");

    // 2. Extrair texto do PDF
    let pdfText = "";
    try {
      const parser = new PDFParse({ data: req.file.buffer });
      const pdfData = await parser.getText();
      pdfText = pdfData.text;
      console.log("Texto extraído com sucesso. Tamanho:", pdfText.length);
    } catch (pdfError: any) {
      console.error("Erro no PDFParse:", pdfError);
      throw new Error(`Falha ao ler o PDF: ${pdfError.message}`);
    }

    // 3. Autenticação Google
    const credsEnv = process.env.GOOGLE_SHEETS_CREDENTIALS;
    if (!credsEnv) throw new Error("GOOGLE_SHEETS_CREDENTIALS não configurado.");
    const credentials = JSON.parse(credsEnv.trim().replace(/\\n/g, '\n'));

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheetsClient = google.sheets({ version: "v4", auth });

    // 4. Criar planilha
    const spreadsheet = await sheetsClient.spreadsheets.create({
      requestBody: { properties: { title: `Conversão: ${req.file.originalname}` } },
    });
    const spreadsheetId = spreadsheet.data.spreadsheetId;

    // 5. Extração com IA (Gemini)
    // Usamos um prompt simplificado e limitamos o texto para garantir velocidade
    const prompt = `Extraia a tabela de "Maiores Usuários" deste texto de PDF. Retorne APENAS um array JSON de arrays com os cabeçalhos: Marca Ótica, Empresa, Beneficiário, Idade, Tipo Beneficiário, Custo Médico, Qtde de Eventos, % Custo s/ Total, Custo Unitário. Texto: ${pdfText.substring(0, 15000)}`;

    const result = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const jsonString = responseText.replace(/```json|```/g, "").trim();
    const rows = JSON.parse(jsonString);

    // 6. Escrever e Compartilhar
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

    res.json({ 
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      message: "Sucesso!" 
    });

  } catch (error: any) {
    console.error("Erro fatal no handler:", error);
    res.status(500).json({ 
      error: error.message,
      detail: error.stack
    });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
