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
    console.log("Iniciando parse do PDF...");
    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    console.log("PDF processado com sucesso. Total de páginas:", pdfData.total);
    console.log("Tamanho do texto extraído:", pdfData.text.length, "caracteres");
    
    // Setup Google Sheets Auth
    console.log("Configurando autenticação do Google Sheets...");
    if (!process.env.GOOGLE_SHEETS_CREDENTIALS) {
      throw new Error("A variável GOOGLE_SHEETS_CREDENTIALS não está configurada no servidor.");
    }
    
    let credentials;
    try {
      credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
      console.log("Credenciais JSON parseadas com sucesso.");
    } catch (e) {
      console.error("Erro ao parsear GOOGLE_SHEETS_CREDENTIALS:", e);
      throw new Error("Erro ao processar as credenciais do Google Sheets. Verifique se o JSON é válido.");
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheetsClient = google.sheets({ version: "v4", auth });

    // 1. Criar Planilha
    console.log("Criando nova planilha...");
    const spreadsheet = await sheetsClient.spreadsheets.create({
      requestBody: { properties: { title: req.file.originalname } },
    });
    const spreadsheetId = spreadsheet.data.spreadsheetId;
    console.log("Planilha criada. ID:", spreadsheetId);

    // 2. Compartilhar com o usuário
    console.log("Compartilhando planilha...");
    await sheetsClient.permissions.create({
      spreadsheetId: spreadsheetId!,
      requestBody: {
        type: 'user',
        role: 'writer',
        emailAddress: 'webluciano.soares@gmail.com',
      },
    });

    // 3. Extrair dados com IA (Gemini)
    console.log("Chamando Gemini AI para extração de dados...");
    const prompt = `
      Você é um especialista em extração de dados. Sua tarefa é extrair APENAS os dados da tabela principal contida no texto do PDF abaixo.
      
      REGRAS CRÍTICAS:
      1. Ignore qualquer texto que não faça parte das colunas da tabela.
      2. Retorne APENAS um array JSON de arrays (matriz), onde cada sub-array é uma linha da tabela.
      3. A primeira linha do JSON deve conter os cabeçalhos: "Marca Ótica", "Empresa", "Beneficiário", "Idade", "Tipo Beneficiário", "Custo Médico", "Qtde de Eventos", "% Custo s/ Total", "Custo Unitário".
      4. Consolidação: Se uma célula tiver múltiplas linhas, junte-as em uma única string.
      5. Retorne APENAS o código JSON puro.

      CONTEÚDO DO PDF:
      ${pdfData.text.substring(0, 30000)} // Limitamos a 30k caracteres para evitar estouro de tokens/timeout
    `;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("A variável GEMINI_API_KEY não está configurada.");
    }

    const result = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("Gemini AI respondeu.");
    
    // Limpar possível markdown
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
      console.log("JSON da IA parseado com sucesso. Total de linhas:", rows.length);
    } catch (e) {
      console.error("Falha no parse do JSON da IA. Resposta bruta:", responseText);
      throw new Error("A IA retornou um formato inválido. Tente enviar um arquivo menor ou com menos páginas.");
    }

    // 4. Escrever na planilha
    console.log("Escrevendo dados no Google Sheets...");
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: spreadsheetId!,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
    console.log("Processo concluído com sucesso.");
    
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
