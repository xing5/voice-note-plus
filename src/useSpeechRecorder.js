import { useRef, useState, useEffect } from 'react';

export function useSpeechRecorder({ onAudioReady, sampleRate = 16000 }) {
  const [stream, setStream] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecorder, setHasRecorder] = useState(false);
  
  const recorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const chunksRef = useRef([]);
  
  const startRecording = async () => {
    try {
      if (!hasRecorder) {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setStream(mediaStream);
        
        audioContextRef.current = new AudioContext({ sampleRate });
        recorderRef.current = new MediaRecorder(mediaStream);
        
        recorderRef.current.onstart = () => {
          setIsRecording(true);
          chunksRef.current = [];
        };
        
        recorderRef.current.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };
        
        recorderRef.current.onstop = async () => {
          setIsRecording(false);
          
          // Process the audio
          if (chunksRef.current.length > 0) {
            const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
            const fileReader = new FileReader();
            
            fileReader.onloadend = async () => {
              try {
                const arrayBuffer = fileReader.result;
                const audioData = await audioContextRef.current.decodeAudioData(arrayBuffer);
                const audio = audioData.getChannelData(0);
                
                console.log("Audio processed, length:", audio.length, "samples");
                
                // Call the callback with the audio data
                onAudioReady(audio);
              } catch (error) {
                console.error("Error processing audio:", error);
                onAudioReady(null, error);
              }
            };
            
            fileReader.readAsArrayBuffer(blob);
          } else {
            console.log("No audio chunks collected");
            onAudioReady(null, new Error("No audio recorded"));
          }
          
          // Release resources
          if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            setStream(null);
          }
          
          setHasRecorder(false);
        };
        
        setHasRecorder(true);
      }
      
      // Start recording with a reasonable chunk size
      recorderRef.current.start(200);
    } catch (error) {
      console.error("Error starting recording:", error);
      onAudioReady(null, error);
    }
  };
  
  const stopRecording = () => {
    if (recorderRef.current && isRecording) {
      recorderRef.current.stop();
    }
  };
  
  // Clean up resources on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stream]);
  
  return {
    startRecording,
    stopRecording,
    isRecording,
    stream
  };
} 