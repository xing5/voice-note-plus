import { useEffect, useState, useRef } from "react";

import { AudioVisualizer } from "./components/AudioVisualizer";
import Progress from "./components/Progress";
import { LanguageSelector } from "./components/LanguageSelector";
import { RecordingTimer } from "./components/RecordingTimer";

const IS_WEBGPU_AVAILABLE = !!navigator.gpu;

const WHISPER_SAMPLING_RATE = 16_000;
const MAX_AUDIO_LENGTH = 30; // seconds
const MAX_SAMPLES = WHISPER_SAMPLING_RATE * MAX_AUDIO_LENGTH;

function App() {
  // Create a reference to the worker object.
  const worker = useRef(null);

  const recorderRef = useRef(null);

  // Model loading and progress
  const [status, setStatus] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);

  // Inputs and outputs
  const [text, setText] = useState("");
  const [tps, setTps] = useState(null);
  const [language, setLanguage] = useState("en");

  // Processing
  const [recording, setRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [chunks, setChunks] = useState([]);
  const [stream, setStream] = useState(null);
  const [transcribedMarker, setTranscribedMarker] = useState(0);
  const audioContextRef = useRef(null);

  // Add a new state for tracking if we have an active recorder
  const [hasRecorder, setHasRecorder] = useState(false);

  // Add a new state for polished text
  const [polishedText, setPolishedText] = useState("");
  const [isPolishing, setIsPolishing] = useState(false);
  
  // Processing progress for the respect meter
  const [processingProgress, setProcessingProgress] = useState(0);

  // Add state for showing original or polished text
  const [showOriginal, setShowOriginal] = useState(false);

  // We use the `useEffect` hook to setup the worker as soon as the `App` component is mounted.
  useEffect(() => {
    if (!worker.current) {
      // Create the worker if it does not yet exist.
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
    }

    // Create a callback function for messages from the worker thread.
    const onMessageReceived = (e) => {
      switch (e.data.status) {
        case "loading":
          // Model file start load: add a new progress item to the list.
          setStatus("loading");
          setLoadingMessage(e.data.data);
          break;

        case "initiate":
          setProgressItems((prev) => [...prev, e.data]);
          break;

        case "progress":
          // Model file progress: update one of the progress items.
          setProgressItems((prev) =>
            prev.map((item) => {
              if (item.file === e.data.file) {
                return { ...item, ...e.data };
              }
              return item;
            })
          );
          break;

        case "done":
          // Model file loaded: remove the progress item from the list.
          setProgressItems((prev) => prev.filter((item) => item.file !== e.data.file));
          break;

        case "ready":
          // Pipeline ready: the worker is ready to accept messages.
          setStatus("ready");
          recorderRef.current?.start();
          break;

        case "start":
          {
            // Start generation
            setIsProcessing(true);
            setProcessingProgress(0);

            // Request new data from the recorder
            recorderRef.current?.requestData();
          }
          break;

        case "update":
          {
            // Generation update: update the output text.
            const { tps, progress } = e.data;
            setTps(tps);
            if (progress) {
              setProcessingProgress(progress);
            }
          }
          break;

        case "complete":
          // Generation complete: re-enable the "Generate" button
          setIsProcessing(false);
          setProcessingProgress(1); // Set to 100%
          // Append the new transcription to the accumulated text
          setText(prev => {
            // Add a space between transcriptions if needed
            const separator = prev && e.data.output ? " " : "";
            return prev + separator + e.data.output;
          });
          break;

        case "polishing":
          // Text polishing has started
          setIsPolishing(true);
          setProcessingProgress(0);
          break;

        case "polishing_update":
          // Streaming update from the polishing process
          setIsPolishing(true);
          if (e.data.progress) {
            setProcessingProgress(e.data.progress);
          }
          setPolishedText(prev => {
            const separator = prev && e.data.output ? " " : "";
            return prev + separator + e.data.polishedText;
          });
          break;

        case "polished":
          // Text polishing is complete
          setIsPolishing(false);
          setProcessingProgress(1); // Set to 100%
          setPolishedText(e.data.polishedText);
          break;
      }
    };

    // Attach the callback function as an event listener.
    worker.current.addEventListener("message", onMessageReceived);

    // Define a cleanup function for when the component is unmounted.
    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
    };
  }, []);

  // Modify the startRecording function to reset transcriptions for a new session
  const startRecording = async () => {
    try {
      if (!hasRecorder) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setStream(stream);

        recorderRef.current = new MediaRecorder(stream);
        audioContextRef.current = new AudioContext({
          sampleRate: WHISPER_SAMPLING_RATE,
        });

        recorderRef.current.onstart = () => {
          setRecording(true);
          setChunks([]);
          // Clear transcriptions for new recording session
          setText("");
          setPolishedText("");
        };
        recorderRef.current.ondataavailable = (e) => {
          if (e.data.size > 0) {
            setChunks((prev) => [...prev, e.data]);
          } else {
            // Empty chunk received, so we request new data after a short timeout
            setTimeout(() => {
              recorderRef.current.requestData();
            }, 1000);
          }
        };

        recorderRef.current.onstop = () => {
          setRecording(false);
        };

        setHasRecorder(true);
      }

      recorderRef.current.start(10);
    } catch (err) {
      console.error("Error starting recording:", err);
    }
  };

  // Modify the stopRecording function to release resources and trigger text polishing
  const stopRecording = () => {
    if (recorderRef.current && recording) {
      recorderRef.current.stop();

      // Release resources
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        setStream(null);
      }

      recorderRef.current = null;
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      setTranscribedMarker(0);
      setHasRecorder(false);
      
      // Always show a result, even if empty
      setIsPolishing(true);
      
      if (text.trim()) {
        // Send the full transcription to the worker for polishing
        worker.current.postMessage({
          type: "polish",
          data: { text }
        });
      } else {
        // Handle empty transcription
        setTimeout(() => {
          setIsPolishing(false);
          setPolishedText("I didn't hear anything. Try speaking a bit louder or check if your microphone is working.");
        }, 1000);
      }
    }
  };

  useEffect(() => {
    if (!recorderRef.current) return;
    if (!recording) return;
    if (isProcessing) return;
    if (status !== "ready") return;

    if (chunks.length > 0) {
      // Generate from data
      const blob = new Blob(chunks, { type: recorderRef.current.mimeType });

      const fileReader = new FileReader();

      fileReader.onloadend = async () => {
        const arrayBuffer = fileReader.result;
        const decoded = await audioContextRef.current.decodeAudioData(arrayBuffer);
        let audio = decoded.getChannelData(0);
        
        // Get the new audio segment since last transcription
        const newAudioSegment = audio.slice(transcribedMarker);
        
        // Check if the segment contains any non-silent audio
        const hasNonSilentAudio = containsNonSilentAudio(newAudioSegment);
        
        // Only proceed if there's actual audio content or we've reached max length
        if (hasNonSilentAudio || newAudioSegment.length > MAX_SAMPLES) {
          // Check if we should transcribe based on:
          // 1. Max length reached, or
          // 2. Silence detected at the end (indicating potential end of sentence)
          const shouldTranscribe = 
            newAudioSegment.length > MAX_SAMPLES || 
            hasSilenceAtEnd(newAudioSegment);
          
          if (shouldTranscribe) {
            console.log("sending audio to worker. marker:length is ", transcribedMarker, audio.length);
            // Send the entire segment since last transcription
            worker.current.postMessage({
              type: "generate",
              data: { audio: newAudioSegment, language },
            });
            setTranscribedMarker(audio.length);
          }
        } else {
          // If it's all silence, just update the marker without transcribing
          setTranscribedMarker(audio.length);
        }
      };
      fileReader.readAsArrayBuffer(blob);
    } else {
      recorderRef.current?.requestData();
    }
  }, [status, recording, isProcessing, chunks, language]);

  // Helper function to check if audio contains any non-silent content
  const containsNonSilentAudio = (audioData, silenceThreshold = 0.01) => {
    for (let i = 0; i < audioData.length; i++) {
      if (Math.abs(audioData[i]) > silenceThreshold) {
        return true;
      }
    }
    return false;
  };

  // Function to detect if there's silence at the end of the audio
  const hasSilenceAtEnd = (audioData, silenceThreshold = 0.01, minSilenceDuration = 500) => {
    const minSilenceSamples = minSilenceDuration * (WHISPER_SAMPLING_RATE / 1000); // Convert ms to samples
    
    // Only check the last portion of the audio
    const endSamples = Math.min(minSilenceSamples * 2, audioData.length);
    const endAudio = audioData.slice(audioData.length - endSamples);
    
    let consecutiveSilentSamples = 0;
    
    for (let i = 0; i < endAudio.length; i++) {
      if (Math.abs(endAudio[i]) <= silenceThreshold) {
        consecutiveSilentSamples++;
        
        if (consecutiveSilentSamples >= minSilenceSamples) {
          return true;
        }
      } else {
        consecutiveSilentSamples = 0;
      }
    }
    
    return false;
  };

  // Add a function to copy text to clipboard
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(
      () => {
        // You could add a toast notification here
        console.log("Text copied to clipboard");
      },
      (err) => {
        console.error("Could not copy text: ", err);
      }
    );
  };

  // Function to start a new recording session
  const startNewRecording = () => {
    setText("");
    setPolishedText("");
    startRecording();
  };

  return IS_WEBGPU_AVAILABLE ? (
    <div className="min-h-screen bg-warm-50 dark:bg-slate-900 dark:text-warm-100 p-4">
      <header className="py-8">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-heading font-bold text-center text-warm-800 dark:text-warm-200">
            Voice<span className="text-warm-600">Input</span><span className="text-warm-700">+</span>
          </h1>
          <p className="text-center text-warm-600 dark:text-warm-300 mt-2 font-serif italic">
            Speak naturally, get perfectly organized text
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Initial Load Button */}
        {status === null && (
          <div className="mx-auto elegant-card p-8 mb-8 text-center">
            <p className="text-warm-600 dark:text-warm-300 mb-8 font-serif text-lg">
              VoiceInput+ converts your voice into polished text using AI models that run directly in your browser.
              All processing happens locally — no data is sent to any server.
            </p>
            <button
              className="elegant-button"
              onClick={() => {
                worker.current.postMessage({ type: "load" });
                setStatus("loading");
              }}
              disabled={status !== null}
            >
              Load models
            </button>
          </div>
        )}
        
        {/* Loading state */}
        {status === "loading" && (
          <div className="mx-auto elegant-card p-8 mb-8">
            <h2 className="text-2xl font-heading mb-4 text-warm-800 dark:text-warm-200">Loading models...</h2>
            <p className="text-warm-600 dark:text-warm-300 mb-6 font-serif">{loadingMessage}</p>
            {progressItems.map((item) => (
              <Progress
                key={item.file}
                text={item.file}
                percentage={item.progress}
                total={item.total}
              />
            ))}
          </div>
        )}

        {/* Main Interface */}
        {status === "ready" && (
          <div className="mx-auto elegant-card p-8 mb-8">
            {/* Recording Interface */}
            <div className="flex flex-col items-center justify-center gap-6 mb-6">
              {!recording && !isPolishing && (
                <>
                  <p className="text-warm-600 dark:text-warm-400 font-serif text-center mb-2">
                    Click the microphone to start speaking
                  </p>
                  <button
                    onClick={startRecording}
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

              {recording && (
                <>
                  <div className="relative mt-12">
                    <button
                      className="w-28 h-28 bg-warm-700 rounded-full text-white shadow-md flex items-center justify-center border-4 border-warm-200 dark:border-warm-800"
                      aria-label="Stop speaking"
                      onClick={stopRecording}
                    >
                      <span className="absolute inset-0 rounded-full shadow-lg shadow-warm-700/50 animate-pulse"></span>
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
                      <RecordingTimer isRecording={recording} />
                    </div>
                  </div>
                  
                  <div className="mt-2 mb-4 w-full max-w-lg">
                    <AudioVisualizer
                      stream={stream}
                    />
                  </div>
                </>
              )}

              {isPolishing && (
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
                    {text.trim() ? "Polishing your text..." : "Processing your speech..."}
                  </p>
                </div>
              )}
              
              {IS_WEBGPU_AVAILABLE && status === "ready" && (
                <div className="text-sm text-warm-500 dark:text-warm-400 flex items-center mt-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-warm-500 mr-2"></span>
                  WebGPU acceleration enabled
                </div>
              )}
            </div>

            {/* Language Selector - Only show when not recording */}
            {!recording && (
              <div className="mb-6 flex justify-end">
                <div className="flex items-center gap-2">
                  <span className="text-warm-600 dark:text-warm-400 font-serif">Language:</span>
                  <LanguageSelector
                    language={language}
                    onChange={setLanguage}
                    disabled={recording || isProcessing}
                  />
                </div>
              </div>
            )}

            {/* Text Output Section - Only show when we have text or it's being polished */}
            {(polishedText || isPolishing || (text && showOriginal)) && (
              <div className="mt-6">
                <div className="elegant-card p-6 border-2 border-warm-200 dark:border-slate-700">
                  {/* Tabs for switching between original and polished text */}
                  {text && polishedText && !isPolishing && (
                    <div className="flex border-b border-warm-200 dark:border-slate-700 mb-4">
                      <button
                        className={`py-2 px-4 font-serif ${
                          !showOriginal
                            ? "border-b-2 border-warm-600 text-warm-800 dark:text-warm-200"
                            : "text-warm-500 dark:text-warm-400 hover:text-warm-800 dark:hover:text-warm-200"
                        }`}
                        onClick={() => setShowOriginal(false)}
                      >
                        Polished Text
                      </button>
                      <button
                        className={`py-2 px-4 font-serif ${
                          showOriginal
                            ? "border-b-2 border-warm-600 text-warm-800 dark:text-warm-200"
                            : "text-warm-500 dark:text-warm-400 hover:text-warm-800 dark:hover:text-warm-200"
                        }`}
                        onClick={() => setShowOriginal(true)}
                      >
                        Original Transcription
                      </button>
                    </div>
                  )}

                  <div className="min-h-[200px] max-h-[400px] overflow-y-auto scrollbar-thin">
                    {isPolishing ? (
                      <div className="prose prose-warm dark:prose-invert max-w-none font-serif text-lg">
                        <p className="animate-pulse">
                          {text.trim() ? "Improving your text, please wait..." : "Processing your speech..."}
                        </p>
                      </div>
                    ) : (
                      <div className="prose prose-warm dark:prose-invert max-w-none font-serif text-lg leading-relaxed">
                        {showOriginal ? (
                          <p>{text || "Nothing detected from your speech."}</p>
                        ) : (
                          <p className={polishedText.includes("I didn't catch that") ? "text-warm-500 italic" : ""}>
                            {polishedText}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions for text */}
                  {(polishedText || (text && showOriginal)) && !recording && (
                    <div className="mt-6 flex justify-between items-center">
                      <button
                        className="elegant-button flex items-center bg-warm-700"
                        onClick={startNewRecording}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5 mr-2"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Speak Again
                      </button>
                      
                      <button
                        className="elegant-button flex items-center"
                        onClick={() => copyToClipboard(showOriginal ? text : polishedText)}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5 mr-2"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                          <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                        </svg>
                        Copy to Clipboard
                      </button>
                    </div>
                  )}
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
          • All processing happens locally in your browser
        </p>
      </footer>
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
