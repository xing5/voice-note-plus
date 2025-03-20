import { useRef, useEffect } from 'react';

export function useTranscriptionWorker({ onMessage }) {
  const workerRef = useRef(null);
  
  useEffect(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module"
      });
    }
    
    // Set up message handler
    workerRef.current.addEventListener("message", onMessage);
    
    // Clean up
    return () => {
      workerRef.current.removeEventListener("message", onMessage);
    };
  }, [onMessage]);
  
  const loadModels = () => {
    workerRef.current?.postMessage({ type: "load" });
  };
  
  const transcribeAudio = (audio, language) => {
    workerRef.current?.postMessage({
      type: "generate",
      data: { audio, language }
    });
  };
  
  const polishText = (text) => {
    workerRef.current?.postMessage({
      type: "polish",
      data: { text }
    });
  };
  
  return {
    loadModels,
    transcribeAudio,
    polishText
  };
} 