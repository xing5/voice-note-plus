// Initial speech state
export const initialSpeechState = {
  text: "",               // Original transcription
  polishedText: "",       // Polished version
  isRecording: false,     // Active recording state
  isProcessing: false,    // Transcription processing
  isPolishing: false,     // Text polishing
  processingProgress: 0,  // Progress indicator
  showOriginal: false,    // Toggle between original/polished view
  status: null,           // App status (null, loading, ready)
  loadingMessage: "",     // Message during loading
  fadeIn: false,          // Controls fade-in animation
};

// Reducer for managing speech and text processing states
export function speechReducer(state, action) {
  switch (action.type) {
    case 'SET_STATUS':
      return {
        ...state,
        status: action.status,
        loadingMessage: action.message || state.loadingMessage
      };
    
    case 'START_RECORDING':
      return {
        ...state,
        isRecording: true,
        text: "",
        polishedText: "",
        showOriginal: false,
        processingProgress: 0,
        fadeIn: false
      };
    
    case 'STOP_RECORDING':
      return {
        ...state,
        isRecording: false,
        isProcessing: true,
        processingProgress: 0,
        fadeIn: false
      };
    
    case 'TRANSCRIPTION_PROGRESS':
      return {
        ...state,
        processingProgress: action.progress
      };
    
    case 'TRANSCRIPTION_COMPLETE':
      return {
        ...state,
        isProcessing: false,
        text: action.text,
        isPolishing: action.text.trim() ? true : false,
        processingProgress: 1,
        fadeIn: false
      };
    
    case 'POLISHING_PROGRESS':
      return {
        ...state,
        processingProgress: action.progress
      };
    
    case 'POLISHING_COMPLETE':
      return {
        ...state,
        isPolishing: false,
        polishedText: action.polishedText,
        processingProgress: 1,
        fadeIn: true
      };
    
    case 'TOGGLE_VIEW':
      return {
        ...state,
        showOriginal: !state.showOriginal,
        fadeIn: true
      };
    
    case 'RESET':
      return initialSpeechState;
    
    case 'NO_SPEECH_DETECTED':
      return {
        ...state,
        isProcessing: false,
        isPolishing: false,
        text: "",
        polishedText: "I didn't hear anything. Try speaking a bit louder or check if your microphone is working.",
        fadeIn: true
      };
    
    default:
      return state;
  }
} 