import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";

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

    console.log("Enviando PDF diretamente para o Gemini...");

    // 1. Setup Google Sheets
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS!.trim().replace(/\\n/g, '\n'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheetsClient = google.sheets({ version: "v4", auth });

    // 2. Criar Planilha
    const spreadsheet = await sheetsClient.spreadsheets.create({
      requestBody: { properties: { title: `Relatório: ${req.file.originalname}` } },
    });
    const spreadsheetId = spreadsheet.data.spreadsheetId;

    // 3. IA - Enviando o PDF binário diretamente para o Gemini 2.0
    // Isso é muito mais estável pois não exige processamento local do PDF
    const result = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: req.file.buffer.toString("base64"),
                mimeType: "application/pdf",
              },
            },
            {
              text: 'Extraia a tabela de "Maiores Usuários" deste documento. Ignore textos fora da tabela. Retorne APENAS um array JSON de arrays (matriz) com os dados. Cabeçalhos esperados: Marca Ótica, Empresa, Beneficiário, Idade, Tipo Beneficiário, Custo Médico, Qtde de Eventos, % Custo s/ Total, Custo Unitário.',
            },
          ],
        },
      ],
    });
    
    let jsonString = result.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    jsonString = jsonString.replace(/```json|```/g, "").trim();
    const rows = JSON.parse(jsonString);

    // 4. Salvar Dados
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: spreadsheetId!,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });

    // 5. Compartilhar com o usuário
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
    console.error("Erro fatal:", error);
    res.status(500).json({ 
      error: error.message,
      detail: "Ocorreu um erro no processamento da IA. Verifique se o PDF não é protegido por senha." 
    });
  }
}

export const config = {
  api: { bodyParser: false },
};
