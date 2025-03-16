## Product Requirements Document (PRD)

### Product Name
VoiceInput+

### Objective
Develop a simple, web-based AI tool that converts user voice input into polished text. The application will first transcribe the voice input using a speech recognition model, then send the transcription to a dedicated text generation AI model to remove filler words, clarify mumbling, and rephrase sentences for written clarity. It operates entirely locally using Transformer.js with WebGPU acceleration (with CPU fallback when necessary).

### Key Features

1. **Instant Voice-to-Text Generation:**
   - Single-click button to initiate voice recording.
   - Automatic detection of voice end-point.
   - Immediate processing of audio input into refined text.

2. **AI-Powered Text Polishing:**
   - Uses a dedicated text generation model (DeepSeek-R1-Distill-Qwen-1.5B-ONNX) for text refinement.
   - Automatically removes filler words such as "um", "uh", "like", etc.
   - Detects and corrects unclear or mumbled phrases using contextual understanding.
   - Rephrases sentences for clarity, readability, and professionalism.
   - No fallback to simple rule-based processing - relies entirely on AI for high-quality results.

3. **Local Model Execution:**
   - Utilizes Transformer.js for running transformer-based NLP models directly in-browser.
   - Leverages WebGPU acceleration to ensure efficient, low-latency processing on supported devices.
   - Provides CPU fallback for devices without WebGPU support.

4. **User Interface Simplicity:**
   - Minimalist, intuitive UI design with clear visual feedback during processing.
   - No user sign-in required.
   - Single-page web app with immediate functionality upon load.
   - Tabbed interface to view both original and polished text.

5. **Local Output History:**
   - Store transcription history locally within the user's browser using IndexedDB.
   - Display historical outputs in reverse chronological order.
   - Provide options to clear history or delete individual entries.

### Technology Stack
- **Frontend:** React with TypeScript, Headless UI, Tailwind CSS
- **Models:** 
  - Speech recognition: Whisper (onnx-community/whisper-base)
  - Text polishing: DeepSeek-R1-Distill-Qwen-1.5B-ONNX
- **Framework:** Transformer.js
- **Hardware Acceleration:** WebGPU with CPU fallback
- **Local Storage:** Browser's IndexedDB

### Performance Goals
- Voice input processing latency: under 3 seconds for short inputs (<30 seconds speech).
- Text polishing latency: under 2 seconds for typical transcriptions.
- Browser compatibility: Modern browsers with graceful degradation for non-WebGPU browsers.

### Out of Scope
- Multi-user collaboration or cloud-based storage.
- User authentication and account management.
- Server-side processing or API calls to external services.

### Deliverables
- Functional web application demonstrating core capabilities.
- Documentation detailing local setup and usage instructions.
- Source code with clean architecture and TypeScript typing.

### Acceptance Criteria
- User can successfully input voice and receive clear, AI-polished text.
- Both original transcription and AI-polished text are displayed to the user.
- Historical outputs persist locally and remain retrievable across page reloads.
- Application remains performant and responsive on supported browsers.
- Text polishing is performed exclusively by the AI model, with no fallback to rule-based processing.

