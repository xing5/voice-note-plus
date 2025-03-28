import { useEffect, useState, useRef, useReducer, useCallback } from "react";

import { AudioVisualizer } from "./components/AudioVisualizer";
import Progress from "./components/Progress";
import { LanguageSelector } from "./components/LanguageSelector";
import { RecordingTimer } from "./components/RecordingTimer";
import { speechReducer, initialSpeechState } from "./speechReducer";
import { useSpeechRecorder } from "./useSpeechRecorder";
import { useTranscriptionWorker } from "./useTranscriptionWorker";
import SettingsModal from "./components/SettingsModal";

const IS_WEBGPU_AVAILABLE = !!navigator.gpu;

const WHISPER_SAMPLING_RATE = 16_000;
const MAX_AUDIO_LENGTH = 30; // seconds
const MAX_SAMPLES = WHISPER_SAMPLING_RATE * MAX_AUDIO_LENGTH;

// Define a style block for animation keyframes
const fadeInStyle = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .text-fade-in {
    animation: fadeIn 0.8s ease-out forwards;
  }
`;

function App() {
  // Speech state management with reducer
  const [speechState, dispatch] = useReducer(speechReducer, initialSpeechState);
  
  // Handle language selection
  const [language, setLanguage] = useState("en");
  
  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);
  
  // Create a ref to store the worker interface methods
  const workerInterfaceRef = useRef(null);
  
  // Progress tracking for model loading
  const [progressItems, setProgressItems] = useState({});
  
  // Handle worker messages
  const handleWorkerMessage = useCallback((e) => {
    // Log each message for debugging
    console.log("Worker message:", e.data);
    
    switch (e.data.status) {
      case "loading":
        // Model file start load
        dispatch({ type: "SET_STATUS", status: "loading", message: e.data.data });
        break;
        
      case "initiate":
        // Model file download initiated
        setProgressItems(prev => ({
          ...prev,
          [e.data.file]: { 
            text: `Loading ${e.data.file}`, 
            percentage: 0,
            total: e.data.total
          }
        }));
        break;
        
      case "progress":
        // Model file download progress
        setProgressItems(prev => ({
          ...prev,
          [e.data.file]: { 
            text: `Loading ${e.data.file}`, 
            percentage: (e.data.loaded / e.data.total) * 100,
            total: e.data.total
          }
        }));
        break;
        
      case "done":
        // Model file download complete
        setProgressItems(prev => ({
          ...prev,
          [e.data.file]: { 
            text: `Loaded ${e.data.file}`, 
            percentage: 100,
            total: e.data.total
          }
        }));
        break;
      
      case "ready":
        // Pipeline ready
        dispatch({ type: "SET_STATUS", status: "ready" });
        setProgressItems({});  // Clear progress items
        break;
      
      case "start":
        // Start generation
        dispatch({ type: "TRANSCRIPTION_PROGRESS", progress: 0 });
        break;
      
      case "update":
        // Progress update
        if (e.data.progress) {
          dispatch({ type: "TRANSCRIPTION_PROGRESS", progress: e.data.progress });
        }
        break;
      
      case "complete":
        // Transcription complete
        if (e.data.output && e.data.output.trim()) {
          dispatch({ type: "TRANSCRIPTION_COMPLETE", text: e.data.output });
          console.log("Transcription complete, sending for polishing:", e.data.output);
          // Start polishing using the ref
          try {
            workerInterfaceRef.current?.polishText(e.data.output);
          } catch (error) {
            console.error("Error starting text polishing:", error);
            dispatch({ 
              type: "POLISHING_COMPLETE", 
              polishedText: e.data.output // Use the original text if polishing fails
            });
          }
        } else {
          dispatch({ type: "NO_SPEECH_DETECTED" });
        }
        break;
      
      case "polishing":
        // Polishing started
        dispatch({ type: "POLISHING_PROGRESS", progress: 0 });
        break;
      
      case "polishing_update":
        // Polishing progress
        if (e.data.progress) {
          dispatch({ type: "POLISHING_PROGRESS", progress: e.data.progress });
        }
        break;
      
      case "polished":
        // Polishing complete with structured note data
        dispatch({ 
          type: "POLISHING_COMPLETE", 
          polishedText: e.data.polishedText || "I didn't hear anything. Try speaking a bit louder or check if your microphone is working.",
          noteData: e.data.noteData || {
            title: "Untitled Note",
            category: "Uncategorized",
            tags: [],
            content: e.data.polishedText || "I didn't hear anything. Try speaking a bit louder or check if your microphone is working."
          }
        });
        break;
      
      case "error":
        // Handle explicit error messages from worker
        console.error("Worker error:", e.data.error);
        // Get current state values to determine what type of error occurred
        const isPolishing = speechState.isPolishing;
        const isProcessing = speechState.isProcessing;
        const currentText = speechState.text;
        
        if (isPolishing) {
          dispatch({ 
            type: "POLISHING_COMPLETE", 
            polishedText: currentText || "Error during text processing. Please try again."
          });
        } else if (isProcessing) {
          dispatch({ type: "NO_SPEECH_DETECTED" });
        } else {
          // General error during loading or other operations
          dispatch({ type: "SET_STATUS", status: "ready" });
        }
        break;
        
      default:
        console.log("Unknown worker message:", e.data);
        break;
    }
  }, [speechState]);
  
  // Set up worker interface
  const workerInterface = useTranscriptionWorker({ onMessage: handleWorkerMessage });
  
  // Store the worker interface in the ref
  useEffect(() => {
    workerInterfaceRef.current = workerInterface;
  }, [workerInterface]);
  
  // Handle audio ready from recorder
  const handleAudioReady = useCallback((audio, error) => {
    if (error) {
      console.error("Audio recording error:", error);
      dispatch({ type: "NO_SPEECH_DETECTED" });
      return;
    }
    
    if (!audio) {
      dispatch({ type: "NO_SPEECH_DETECTED" });
      return;
    }
    
    console.log("Transcribing audio, length:", audio.length);
    workerInterfaceRef.current?.transcribeAudio(audio, language);
  }, [language]);
  
  // Set up speech recorder
  const { startRecording, stopRecording, isRecording, stream } = useSpeechRecorder({
    onAudioReady: handleAudioReady,
    sampleRate: WHISPER_SAMPLING_RATE
  });
  
  // Start a new recording session
  const handleStartRecording = () => {
    dispatch({ type: "START_RECORDING" });
    startRecording();
  };
  
  // Stop recording and begin processing
  const handleStopRecording = () => {
    dispatch({ type: "STOP_RECORDING" });
    stopRecording();
  };
  
  // Toggle between original and polished text
  const toggleTextView = () => {
    dispatch({ type: "TOGGLE_VIEW" });
  };
  
  // Copy text to clipboard
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
      .then(() => console.log("Text copied to clipboard"))
      .catch(err => console.error("Could not copy text:", err));
  };
  
  // Initialize the app
  useEffect(() => {
    // We don't automatically load models anymore, let the user click the button
    // workerInterfaceRef.current?.loadModels();
  }, []);
  
  // Render UI based on current state
  return IS_WEBGPU_AVAILABLE ? (
    <div className="min-h-screen bg-warm-50 dark:bg-slate-900 dark:text-warm-100 p-4">
      {/* Add style tag for animation keyframes */}
      <style dangerouslySetInnerHTML={{ __html: fadeInStyle }} />
      
      <header className="py-8">
        <div className="container mx-auto px-4">
          <div className="flex justify-center items-center">
            <div className="text-center">
              <h1 className="text-4xl font-heading font-bold text-center text-warm-800 dark:text-warm-200">
                Voice<span className="text-warm-600">Note</span><span className="text-warm-700">+</span>
              </h1>
              <p className="text-center text-warm-600 dark:text-warm-300 mt-2 font-serif italic">
                Think out loudly, get perfectly organized notes
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Initial Load Button */}
        {speechState.status === null && (
          <div className="mx-auto elegant-card p-8 mb-8 text-center">
            <p className="text-warm-600 dark:text-warm-300 mb-8 font-serif flex flex-col items-center justify-center space-y-4">
              <span className="text-lg font-medium">
                <strong>VoiceNote+</strong> transforms your speech into polished notes using AI.
              </span>
              <span className="text-sm opacity-80 flex items-center justify-center space-x-4">
                <span>Browser-based AI</span>
                <span className="w-1.5 h-1.5 rounded-full bg-warm-400 dark:bg-warm-500"></span>
                <span>WebGPU powered</span>
                <span className="w-1.5 h-1.5 rounded-full bg-warm-400 dark:bg-warm-500"></span>
                <span>100% private</span>
              </span>
            </p>
            <div className="flex flex-col items-center">
              <button
                className="elegant-button"
                onClick={() => workerInterfaceRef.current?.loadModels()}
                disabled={speechState.status !== null}
              >
                Load models to start
              </button>
              <p className="text-xs text-warm-500 dark:text-warm-400 mt-3 max-w-xs">
                * Models are downloaded only once on first use.
              </p>
            </div>
          </div>
        )}

        {/* Loading state */}
        {speechState.status === "loading" && (
          <div className="mx-auto elegant-card p-8 mb-8">
            <h2 className="text-2xl font-heading mb-4 text-warm-800 dark:text-warm-200">Loading models...</h2>
            <p className="text-warm-600 dark:text-warm-300 mb-6 font-serif">{speechState.loadingMessage}</p>
            {/* Display progress items */}
            {Object.keys(progressItems).length > 0 && (
              <div className="space-y-2">
                {Object.entries(progressItems).map(([key, item]) => (
                  <Progress 
                    key={key}
                    text={item.text}
                    percentage={item.percentage}
                    total={item.total}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recording Interface */}
        {speechState.status === "ready" && (
          <div className="mx-auto elegant-card p-8 mb-8 relative">
            {/* Settings Button */}
            <div className="absolute top-4 right-4">
              <button 
                onClick={() => setShowSettings(true)}
                className="text-warm-600 hover:text-warm-800 dark:text-warm-400 dark:hover:text-warm-200 transition-colors"
                aria-label="Settings"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
            
            <div className="flex flex-col items-center justify-center gap-6 mb-6">
              {/* Start speaking button */}
              {!speechState.isRecording && !speechState.isProcessing && !speechState.isPolishing && (
                <>
                  <p className="text-warm-600 dark:text-warm-400 font-serif text-center mb-2">
                    Click the microphone to start speaking
                  </p>
                  <button
                    onClick={handleStartRecording}
                    className="relative w-28 h-28 bg-warm-600 hover:bg-warm-700 rounded-full text-white shadow-md hover:shadow-lg transition-all duration-300 flex items-center justify-center border-4 border-warm-200 dark:border-warm-800"
                    aria-label="Start speaking"
                  >
                    <span className="sr-only">Start speaking</span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-14 w-14"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </>
              )}

              {/* Stop speaking button */}
              {speechState.isRecording && (
                <>
                  <div className="relative mt-12">
                    <button
                      className="w-28 h-28 bg-warm-700 rounded-full text-white shadow-md flex items-center justify-center border-4 border-warm-200 dark:border-warm-800 transition-all duration-300"
                      aria-label="Stop speaking"
                      onClick={handleStopRecording}
                    >
                      <span className="shadow-lg shadow-warm-700/50 animate-pulse absolute inset-0 rounded-full"></span>
                      <span className="sr-only">Stop speaking</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-12 w-12"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <rect x="4" y="4" width="12" height="12" rx="1" />
                      </svg>
                    </button>
                    <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 min-w-[80px] text-center">
                      <RecordingTimer isRecording={speechState.isRecording} />
                    </div>
                  </div>
                  
                  <div className="mt-2 mb-4 w-full max-w-lg">
                    <AudioVisualizer stream={stream} />
                  </div>
                </>
              )}

              {/* Processing indicator */}
              {(speechState.isProcessing || speechState.isPolishing) && (
                <div className="flex flex-col items-center">
                  <div className="w-28 h-28 flex items-center justify-center">
                    <svg
                      className="animate-spin text-warm-600 dark:text-warm-300"
                      width="64"
                      height="64"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                  <p className="text-warm-600 dark:text-warm-400 mt-4 font-serif text-center">
                    {speechState.isProcessing ? "Processing your speech..." : "Polishing your text..."}
                  </p>
                </div>
              )}
            </div>

            {/* Text Output Section */}
            {(speechState.polishedText || (speechState.text && speechState.showOriginal)) && 
             !speechState.isPolishing && (
              <div className="mt-6">
                <div 
                  className={`elegant-card p-6 border-2 border-warm-200 dark:border-slate-700 transition-all duration-700 ease-in-out ${
                    speechState.fadeIn ? 'text-fade-in' : 'opacity-0'
                  }`}
                >
                  {/* Note Layout with Title, Date/Time, and Content */}
                  <div className="note-container">
                    {/* Note Header with Title and Date */}
                    <div className="mb-4 border-b border-warm-200 dark:border-slate-700 pb-3">
                      <div className="flex justify-between items-start">
                        <h3 className="text-xl font-heading font-bold text-warm-800 dark:text-warm-200">
                          {/* Use AI-generated title when available */}
                          {speechState.noteData?.title || 
                            (speechState.polishedText ? 
                              `Note - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 
                              "Nothing detected"
                            )
                          }
                        </h3>
                        <div className="flex items-center space-x-3">
                          {/* Copy to Clipboard Button */}
                          {(speechState.polishedText || speechState.text) && (
                            <button
                              onClick={() => copyToClipboard(speechState.polishedText || speechState.text)}
                              className="text-warm-500 hover:text-warm-700 dark:text-warm-400 dark:hover:text-warm-200 transition-colors"
                              aria-label="Copy to clipboard"
                              title="Copy to clipboard"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                                <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                              </svg>
                            </button>
                          )}
                          
                          {/* Share Button - Only shows if Web Share API is available */}
                          {(speechState.polishedText || speechState.text) && navigator.share && (
                            <button
                              onClick={() => {
                                // Use Web Share API to share the note content
                                navigator.share({
                                  title: 'My Note from VoiceNote+',
                                  text: speechState.polishedText || speechState.text,
                                })
                                .catch(err => console.error('Error sharing:', err));
                              }}
                              className="text-warm-500 hover:text-warm-700 dark:text-warm-400 dark:hover:text-warm-200 transition-colors"
                              aria-label="Share note"
                              title="Share note"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
                              </svg>
                            </button>
                          )}
                          
                          {/* Original Transcription Button */}
                          {speechState.text && (
                            <button
                              onClick={() => {
                                // Toggle original transcription popup visibility
                                dispatch({ type: "TOGGLE_ORIGINAL_TRANSCRIPTION" });
                              }}
                              className="text-warm-500 hover:text-warm-700 dark:text-warm-400 dark:hover:text-warm-200 transition-colors"
                              aria-label="View original transcription"
                              title="View original transcription"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {/* Show category as a badge */}
                        {speechState.noteData?.category && (
                          <span className="px-2 py-1 text-xs font-medium bg-warm-100 text-warm-800 dark:bg-slate-700 dark:text-warm-300 rounded-full">
                            {speechState.noteData.category}
                          </span>
                        )}
                        
                        {/* Show tags */}
                        {speechState.noteData?.tags && speechState.noteData.tags.length > 0 && 
                          speechState.noteData.tags.map((tag, index) => (
                            <span 
                              key={index} 
                              className="px-2 py-1 text-xs font-medium bg-warm-50 text-warm-600 dark:bg-slate-800 dark:text-warm-400 rounded-full border border-warm-200 dark:border-slate-600"
                            >
                              #{tag}
                            </span>
                          ))
                        }
                      </div>
                      <div className="text-sm text-warm-500 dark:text-warm-400 font-serif mt-2">
                        {new Date().toLocaleString('en-US', { 
                          weekday: 'long',
                          month: 'long', 
                          day: 'numeric', 
                          year: 'numeric',
                          hour: 'numeric', 
                          minute: 'numeric'
                        })}
                      </div>
                    </div>

                    {/* Note Content */}
                    <div className="min-h-[200px] max-h-[400px] overflow-y-auto scrollbar-thin">
                      <div 
                        className="prose prose-warm dark:prose-invert max-w-none font-serif text-lg leading-relaxed"
                      >
                        {speechState.polishedText && !speechState.showOriginal ? (
                          <p className={speechState.polishedText.includes("I didn't hear anything") ? "text-warm-500 italic" : ""}>
                            {speechState.polishedText}
                          </p>
                        ) : (
                          <p className="text-warm-500 italic">Nothing detected from your speech.</p>
                        )}
                      </div>
                    </div>
                    
                    {/* Original Transcription Popup */}
                    {speechState.showOriginalTranscription && speechState.text && (
                      <div className="mt-4 p-4 bg-warm-50 dark:bg-slate-800 rounded-lg border border-warm-200 dark:border-slate-700">
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="text-sm font-medium text-warm-600 dark:text-warm-300">Original Transcription</h4>
                          <button
                            onClick={() => dispatch({ type: "TOGGLE_ORIGINAL_TRANSCRIPTION" })}
                            className="text-warm-500 hover:text-warm-700 dark:text-warm-400 dark:hover:text-warm-200 transition-colors"
                            aria-label="Close"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                        <p className="text-warm-600 dark:text-warm-400 text-sm font-serif italic">
                          {speechState.text}
                        </p>
                      </div>
                    )}

                    {/* Actions for text - removed Speak Again button */}
                    {(speechState.polishedText || speechState.text) && 
                    !speechState.isRecording && !speechState.isProcessing && (
                      <div className="mt-6 flex justify-end items-center">
                        {/* Removed Speak Again button */}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="py-6 text-center text-warm-500 dark:text-warm-400 text-sm font-serif">
        <p>
          Powered by{" "}
          <a
            href="https://github.com/xenova/transformers.js"
            target="_blank"
            rel="noopener noreferrer"
            className="text-warm-700 dark:text-warm-300 hover:underline"
          >
            Transformers.js
          </a>{" "}
          <span className="mx-1 font-xs">•</span> Free <span className="mx-1 font-xs">•</span>{" "}
          <a
            href="https://github.com/xing5/voice-note-plus"
            target="_blank"
            rel="noopener noreferrer"
            className="text-warm-700 dark:text-warm-300 hover:underline"
          >
            Open source
          </a>
        </p>
      </footer>
      
      {/* Settings Modal */}
      <SettingsModal 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
        language={language}
        onLanguageChange={setLanguage}
      />
    </div>
  ) : (
    <div className="fixed w-screen h-screen bg-black z-10 bg-opacity-[92%] text-white text-2xl font-serif font-semibold flex justify-center items-center text-center">
      WebGPU is not supported
      <br />
      by this browser :&#40;
    </div>
  );
}

export default App;
