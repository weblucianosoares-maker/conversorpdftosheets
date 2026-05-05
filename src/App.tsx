import { useState } from 'react';
import { Upload, FileText, CheckCircle, Loader2, ExternalLink, FileUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'converting' | 'success'>('idle');
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setFile(event.target.files[0]);
      setStatus('idle');
    }
  };

  const handleConvert = async () => {
    if (!file) return;
    setStatus('uploading');
    
    const formData = new FormData();
    formData.append('pdf', file);

    try {
      // Pequeno delay visual para mostrar o estado de upload
      await new Promise(resolve => setTimeout(resolve, 1000));
      setStatus('converting');

      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        let errorMessage = 'Falha na conversão';
        try {
          const errorData = JSON.parse(text);
          errorMessage = errorData.detail || errorData.error || text;
        } catch (e) {
          errorMessage = text || 'Erro interno (sem mensagem)';
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setSpreadsheetUrl(data.spreadsheetUrl);
      setStatus('success');
    } catch (error: any) {
      console.error(error);
      setStatus('idle');
      alert(`Erro: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 text-white font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass p-10 rounded-3xl shadow-2xl w-full max-w-lg relative overflow-hidden"
      >
        {/* Background glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-blue-500/20 blur-3xl rounded-full" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-indigo-500/20 blur-3xl rounded-full" />

        <div className="relative z-10">
          <header className="mb-10 text-center">
            <h1 className="text-4xl font-extrabold tracking-tight mb-2 gradient-text">
              PDF to Sheets
            </h1>
            <p className="text-slate-400 font-medium">
              Converta tabelas complexas em planilhas estruturadas
            </p>
          </header>
          
          <div className="mb-8">
            <input 
              type="file" 
              accept="application/pdf" 
              onChange={handleFileChange}
              className="hidden" 
              id="file-upload"
            />
            <label 
              htmlFor="file-upload" 
              className={`
                cursor-pointer flex flex-col items-center justify-center h-48 rounded-2xl border-2 border-dashed 
                transition-all duration-300 group
                ${file ? 'border-blue-500 bg-blue-500/5' : 'border-slate-700 hover:border-slate-500 bg-slate-800/30'}
              `}
            >
              <AnimatePresence mode="wait">
                {file ? (
                  <motion.div 
                    key="file-selected"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="flex flex-col items-center"
                  >
                    <FileText className="w-16 h-16 text-blue-400 mb-4" />
                    <span className="text-blue-200 font-semibold px-6 text-center line-clamp-1">
                      {file.name}
                    </span>
                    <span className="text-slate-500 text-sm mt-2">Clique para trocar o arquivo</span>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="no-file"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="flex flex-col items-center"
                  >
                    <FileUp className="w-16 h-16 text-slate-500 mb-4 group-hover:text-slate-400 transition-colors" />
                    <span className="text-slate-400 font-medium text-lg">
                      Selecione o arquivo PDF
                    </span>
                    <span className="text-slate-600 text-sm mt-1">Arraste ou clique para navegar</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </label>
          </div>

          <button 
            onClick={handleConvert}
            disabled={!file || status !== 'idle'}
            className={`
              w-full py-4 rounded-2xl font-bold text-lg transition-all duration-300 flex items-center justify-center gap-3
              ${status === 'idle' && file 
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-lg hover:shadow-blue-500/20 hover:scale-[1.02]' 
                : 'bg-slate-800 text-slate-500'}
              disabled:cursor-not-allowed
            `}
          >
            {status === 'idle' && (
              <>
                <span>Converter para Google Sheets</span>
              </>
            )}
            {status === 'uploading' && (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Enviando arquivo...</span>
              </>
            )}
            {status === 'converting' && (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>IA processando tabelas...</span>
              </>
            )}
            {status === 'success' && (
              <>
                <CheckCircle className="w-5 h-5" />
                <span>Concluído com Sucesso</span>
              </>
            )}
          </button>

          <AnimatePresence>
            {status === 'success' && spreadsheetUrl && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-8 space-y-4"
              >
                <div className="flex items-center justify-center text-accent font-bold py-3 bg-accent/10 rounded-xl border border-accent/20">
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Planilha criada com sucesso!
                </div>
                <a 
                  href={spreadsheetUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-center w-full bg-slate-100 text-slate-950 py-4 rounded-2xl font-bold hover:bg-white transition-colors gap-2"
                >
                  <ExternalLink className="w-5 h-5" />
                  Abrir no Google Sheets
                </a>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
