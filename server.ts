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

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// API routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/convert", upload.single("pdf"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo PDF enviado" });
  }

  try {
    // Parse PDF
    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    console.log("PDF processado, total de páginas:", pdfData.total);
    
    // Setup Google Sheets Auth
    if (!process.env.GOOGLE_SHEETS_CREDENTIALS) {
      throw new Error("A variável GOOGLE_SHEETS_CREDENTIALS não está configurada no servidor.");
    }
    
    let credentials;
    try {
      credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    } catch (e) {
      throw new Error("Erro ao processar as credenciais do Google Sheets. Verifique se o JSON é válido.");
    }

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

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("A variável GEMINI_API_KEY não está configurada no servidor.");
    }

    const result = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    // Limpar possível markdown ou texto extra do Gemini
    let jsonString = responseText;
    if (jsonString.includes("```")) {
      jsonString = jsonString.split("```")[1]; 
      if (jsonString.startsWith("json")) {
        jsonString = jsonString.substring(4);
      }
    }
    jsonString = jsonString.trim();
    
    let rows;
    try {
      rows = JSON.parse(jsonString);
    } catch (e) {
      console.error("Falha no parse do JSON da IA:", responseText);
      throw new Error("A IA retornou um formato inválido. Tente novamente.");
    }

    // 4. Escrever na planilha
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: spreadsheetId!,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
    
    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    res.json({ spreadsheetUrl, filename: req.file.originalname });
  } catch (error: any) {
    console.error("Erro na conversão:", error);
    res.status(500).json({ error: error.message || "Erro interno no servidor" });
  }
});

// Vite middleware logic
async function setupVite() {
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
}

// Only start the server if this file is run directly (not as a handler)
if (process.env.NODE_ENV !== "production") {
  setupVite().then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
}

export default app;
