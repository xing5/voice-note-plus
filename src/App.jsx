import { useEffect, useState, useRef } from "react";

import { AudioVisualizer } from "./components/AudioVisualizer";
import Progress from "./components/Progress";
import { LanguageSelector } from "./components/LanguageSelector";

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

            // Request new data from the recorder
            recorderRef.current?.requestData();
          }
          break;

        case "update":
          {
            // Generation update: update the output text.
            const { tps } = e.data;
            setTps(tps);
          }
          break;

        case "complete":
          // Generation complete: re-enable the "Generate" button
          setIsProcessing(false);
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
          break;

        case "polishing_update":
          // Streaming update from the polishing process
          setIsPolishing(true);
          setPolishedText(prev => {
            const separator = prev && e.data.output ? " " : "";
            return prev + separator + e.data.polishedText;
          })
          break;

        case "polished":
          // Text polishing is complete
          setIsPolishing(false);
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
      
      // Only polish if we have transcription text
      if (text.trim()) {
        setIsPolishing(true);
        // Send the full transcription to the worker for polishing
        worker.current.postMessage({
          type: "polish",
          data: { text }
        });
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
    if (audioData.length === 0) return false;
    
    const sampleRate = audioContextRef.current?.sampleRate || 44100;
    const samplesForMinDuration = Math.floor(minSilenceDuration * sampleRate / 1000);
    
    // Only check the end portion of the audio for silence
    const endSamples = Math.min(audioData.length, samplesForMinDuration * 2);
    const audioToCheck = audioData.slice(audioData.length - endSamples);
    
    let consecutiveSilentSamples = 0;
    
    // Check for silence at the end
    for (let i = 0; i < audioToCheck.length; i++) {
      if (Math.abs(audioToCheck[i]) < silenceThreshold) {
        consecutiveSilentSamples++;
        
        // If we found enough consecutive silent samples
        if (consecutiveSilentSamples >= samplesForMinDuration) {
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

  return IS_WEBGPU_AVAILABLE ? (
    <div className="flex flex-col h-screen mx-auto justify-end text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
      {
        <div className="h-full overflow-auto scrollbar-thin flex justify-center items-center flex-col relative">
          <div className="flex flex-col items-center mb-6 max-w-[500px] text-center">
            <h1 className="text-4xl font-bold mb-1">VoiceInput+</h1>
            <h2 className="text-xl font-semibold">AI-powered voice to polished text</h2>
          </div>

          <div className="flex flex-col items-center px-4 w-full max-w-[600px]">
            {status === null && (
              <>
                <p className="max-w-[480px] mb-4">
                  <br />
                  VoiceInput+ converts your voice into polished text. It uses{" "}
                  <a
                    href="https://huggingface.co/onnx-community/whisper-base"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline"
                  >
                    whisper-base
                  </a>{" "}
                  for transcription and a text polishing model to refine your speech.
                  <br />
                  <br />
                  Everything runs directly in your browser using{" "}
                  <a
                    href="https://huggingface.co/docs/transformers.js"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    🤗&nbsp;Transformers.js
                  </a>{" "}
                  and WebGPU, meaning no data is sent to a server.
                </p>

                <button
                  className="border px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:bg-blue-200 disabled:cursor-not-allowed select-none"
                  onClick={() => {
                    worker.current.postMessage({ type: "load" });
                    setStatus("loading");
                  }}
                  disabled={status !== null}
                >
                  Load models
                </button>
              </>
            )}

            {status === "loading" && (
              <div className="w-full max-w-[500px] text-left mx-auto p-4">
                <p className="text-center">{loadingMessage}</p>
                {progressItems.map(({ file, progress, total }, i) => (
                  <Progress key={i} text={file} percentage={progress} total={total} />
                ))}
              </div>
            )}

            {status === "ready" && !recording && !polishedText && (
              <div className="flex flex-col items-center">
                <button
                  onClick={startRecording}
                  className="w-20 h-20 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center transition-all duration-200 shadow-lg hover:shadow-xl"
                  aria-label="Start recording"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>
                <p className="mt-4 text-lg">Click to start speaking</p>
                
                <div className="mt-6">
                  <LanguageSelector
                    language={language}
                    setLanguage={setLanguage}
                  />
                </div>
              </div>
            )}

            {status === "ready" && recording && (
              <div className="w-full max-w-[600px] flex flex-col items-center">
                <div className="w-full mb-4">
                  <AudioVisualizer className="w-full h-16 rounded-lg" stream={stream} />
                </div>
                
                <div className="w-full bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-4">
                  <h3 className="text-lg font-semibold mb-2">Transcription</h3>
                  <div className="relative">
                    <p className="w-full h-[150px] overflow-y-auto overflow-wrap-anywhere border rounded-lg p-3 bg-gray-50 dark:bg-gray-700">
                      {text || "Listening..."}
                    </p>
                    {tps && <span className="absolute bottom-2 right-2 px-1 text-xs bg-gray-100 dark:bg-gray-600 rounded">{tps.toFixed(2)} tok/s</span>}
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <button
                    onClick={stopRecording}
                    className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                  >
                    Stop Speaking
                  </button>
                </div>
                
                <div className="mt-4">
                  <LanguageSelector
                    language={language}
                    setLanguage={(e) => {
                      recorderRef.current?.stop();
                      setLanguage(e);
                      recorderRef.current?.start();
                    }}
                  />
                </div>
              </div>
            )}

            {status === "ready" && !recording && (polishedText || isPolishing) && (
              <div className="w-full max-w-[600px] flex flex-col items-center">
                {/* Original transcription card */}
                <div className="w-full bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-4">
                  <h3 className="text-lg font-semibold mb-2">Original Transcription</h3>
                  <div className="relative">
                    <p className="w-full h-[100px] overflow-y-auto overflow-wrap-anywhere border rounded-lg p-3 bg-gray-50 dark:bg-gray-700">
                      {text}
                    </p>
                  </div>
                </div>
                
                {/* Polished text card */}
                <div className="w-full bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-lg font-semibold">Polished Text</h3>
                    {polishedText && (
                      <button 
                        onClick={() => copyToClipboard(polishedText)}
                        className="text-blue-500 hover:text-blue-700 flex items-center"
                        aria-label="Copy to clipboard"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                        Copy
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <p className="w-full h-[100px] overflow-y-auto overflow-wrap-anywhere border rounded-lg p-3 bg-gray-50 dark:bg-gray-700">
                      {polishedText}
                    </p>
                  </div>
                </div>
                
                {/* New recording button */}
                <button
                  onClick={() => {
                    setText("");
                    setPolishedText("");
                    startRecording();
                  }}
                  className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                >
                  New Recording
                </button>
              </div>
            )}
          </div>
        </div>
      }
    </div>
  ) : (
    <div className="fixed w-screen h-screen bg-black z-10 bg-opacity-[92%] text-white text-2xl font-semibold flex justify-center items-center text-center">
      WebGPU is not supported
      <br />
      by this browser :&#40;
    </div>
  );
}

export default App;
