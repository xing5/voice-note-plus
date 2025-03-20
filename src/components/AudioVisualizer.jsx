import { useRef, useCallback, useEffect, useState } from "react";

export function AudioVisualizer({ stream, ...props }) {
  const canvasRef = useRef(null);
  const [isActive, setIsActive] = useState(false);
  
  const visualize = useCallback((stream) => {
    if (!stream) return;
    
    setIsActive(true);
    const audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const canvasCtx = canvas.getContext("2d");
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    const drawVisual = () => {
      if (!isActive) return;
      
      requestAnimationFrame(drawVisual);
      analyser.getByteFrequencyData(dataArray);

      // Use elegant warm color palette
      const gradient = canvasCtx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, "#A67D4B"); // warm-600
      gradient.addColorStop(1, "#DBBFA0"); // warm-300

      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      
      x = 0;
      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] * 0.5;
        
        // Skip drawing very low values for a cleaner look
        if (barHeight < 5) {
          x += barWidth + 2;
          continue;
        }
        
        // Rounded bar style
        canvasCtx.fillStyle = gradient;
        canvasCtx.beginPath();
        canvasCtx.roundRect(x, canvas.height - barHeight, barWidth, barHeight, 4);
        canvasCtx.fill();
        
        x += barWidth + 2;
      }
    };

    drawVisual();
    
    return () => {
      setIsActive(false);
      audioContext.close();
    };
  }, [isActive]);

  useEffect(() => {
    const cleanup = stream ? visualize(stream) : undefined;
    return () => {
      if (cleanup) cleanup();
      setIsActive(false);
    };
  }, [visualize, stream]);
  
  return (
    <div className="elegant-card p-1 w-full">
      <canvas 
        {...props} 
        width={720} 
        height={100} 
        ref={canvasRef} 
        className="w-full h-full"
      />
    </div>
  );
}
