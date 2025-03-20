import { useState, useEffect } from 'react';

export function RecordingTimer({ isRecording }) {
  const [seconds, setSeconds] = useState(0);
  
  useEffect(() => {
    let intervalId;
    
    if (isRecording) {
      // Reset timer when recording starts
      setSeconds(0);
      
      // Start the timer
      intervalId = setInterval(() => {
        setSeconds(prev => prev + 1);
      }, 1000);
    } else {
      // Clear the timer when recording stops
      setSeconds(0);
    }
    
    // Clean up the interval on unmount or when recording state changes
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isRecording]);
  
  // Format the time as mm:ss
  const formatTime = () => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    const formattedMinutes = String(minutes).padStart(2, '0');
    const formattedSeconds = String(remainingSeconds).padStart(2, '0');
    
    return `${formattedMinutes}:${formattedSeconds}`;
  };
  
  return (
    <div className="font-serif text-warm-700 dark:text-warm-300 text-xl tracking-wide">
      {formatTime()}
    </div>
  );
} 