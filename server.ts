import 'dotenv/config';
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "node:path";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { google } from "googleapis";
import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Setup multer for memory storage of file uploads
const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/convert", upload.single("pdf"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded" });
    }

    try {
      // Parse PDF
      const parser = new PDFParse({ data: req.file.buffer });
      const pdfData = await parser.getText();
      console.log("PDF processado, total de páginas:", pdfData.total);
      
      // Setup Google Sheets Auth
      if (!process.env.GOOGLE_SHEETS_CREDENTIALS) {
        throw new Error("GOOGLE_SHEETS_CREDENTIALS não configurado.");
      }
      const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const sheetsClient = google.sheets({ version: "v4", auth });

      // 1. Criar Planilha
      const spreadsheet = await sheetsClient.spreadsheets.create({
        requestBody: { properties: { title: req.file.originalname } },
      });
      const spreadsheetId = spreadsheet.data.spreadsheetId;

      // 2. Compartilhar com o usuário
      await sheetsClient.permissions.create({
        spreadsheetId: spreadsheetId!,
        requestBody: {
          type: 'user',
          role: 'writer',
          emailAddress: 'webluciano.soares@gmail.com',
        },
      });

      // 3. Extrair dados com IA (Gemini)
      // Instruções rigorosas para ignorar textos fora da tabela
      const prompt = `
        Você é um especialista em extração de dados. Sua tarefa é extrair APENAS os dados da tabela principal contida no texto do PDF abaixo.
        
        REGRAS CRÍTICAS:
        1. Ignore qualquer texto que não faça parte das colunas da tabela (títulos do documento, filtros aplicados, números de página, datas de geração, etc).
        2. Retorne APENAS um array JSON de arrays (matriz), onde cada sub-array é uma linha da tabela.
        3. A primeira linha do JSON deve conter exatamente estes cabeçalhos: "Marca Ótica", "Empresa", "Beneficiário", "Idade", "Tipo Beneficiário", "Custo Médico", "Qtde de Eventos", "% Custo s/ Total", "Custo Unitário".
        4. Fidelidade total: Não altere valores, nomes ou códigos. 
        5. Consolidação: Se uma célula tiver múltiplas linhas no PDF (especialmente na coluna Empresa ou Beneficiário), junte-as em uma única string sem quebras de linha.
        6. Limpeza: Remova cabeçalhos que se repetem no meio do texto devido a quebras de página.
        7. Retorne APENAS o código JSON puro, sem blocos de markdown (\`\`\`json) e sem qualquer comentário.

        CONTEÚDO DO PDF PARA EXTRAÇÃO:
        ${pdfData.text}
      `;

      const result = await client.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
      
      // Limpar possível markdown ou texto extra do Gemini
      let jsonString = responseText;
      if (jsonString.includes("```")) {
        jsonString = jsonString.split("```")[1]; // Pega o conteúdo dentro do primeiro bloco de código
        if (jsonString.startsWith("json")) {
          jsonString = jsonString.substring(4);
        }
      }
      jsonString = jsonString.trim();
      
      const rows = JSON.parse(jsonString);

      // 4. Escrever na planilha
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: spreadsheetId!,
        range: "Sheet1!A1",
        valueInputOption: "RAW",
        requestBody: { values: rows },
      });
      
      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      res.json({ spreadsheetUrl, filename: req.file.originalname });
    } catch (error) {
      console.error("Conversion error:", error);
      res.status(500).json({ error: "PDF parsing or Google Sheets API error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
