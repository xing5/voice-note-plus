import {
  AutoTokenizer,
  AutoProcessor,
  WhisperForConditionalGeneration,
  TextStreamer,
  AutoModelForCausalLM,
  full,
} from "@huggingface/transformers";

const MAX_NEW_TOKENS = 64;

/**
 * This class uses the Singleton pattern to ensure that only one instance of the model is loaded.
 */
class AutomaticSpeechRecognitionPipeline {
  static model_id = "onnx-community/whisper-base";
  static tokenizer = null;
  static processor = null;
  static model = null;

  static async getInstance(progress_callback = null) {
    this.tokenizer ??= AutoTokenizer.from_pretrained(this.model_id, {
      progress_callback,
    });
    this.processor ??= AutoProcessor.from_pretrained(this.model_id, {
      progress_callback,
    });

    this.model ??= WhisperForConditionalGeneration.from_pretrained(
      this.model_id,
      {
        dtype: {
          encoder_model: "fp32", // 'fp16' works too
          decoder_model_merged: "q4", // or 'fp32' ('fp16' is broken)
        },
        device: "webgpu",
        progress_callback,
      },
    );

    return Promise.all([this.tokenizer, this.processor, this.model]);
  }
}

/**
 * Text polishing pipeline using DeepSeek model
 */
class TextPolishingPipeline {
  static model_id = "onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX";
  static tokenizer = null;
  static model = null;

  static async getInstance(progress_callback = null) {
    this.tokenizer ??= AutoTokenizer.from_pretrained(this.model_id, {
      progress_callback,
    });

    this.model ??= AutoModelForCausalLM.from_pretrained(
      this.model_id,
      {
        dtype: "q4f16",
        device: "webgpu",
        progress_callback,
      },
    );

    return Promise.all([this.tokenizer, this.model]);
  }
}

let processing = false;
async function generate({ audio, language }) {
  if (processing) return;
  processing = true;

  // Tell the main thread we are starting
  self.postMessage({ status: "start" });

  // Retrieve the text-generation pipeline.
  const [tokenizer, processor, model] =
    await AutomaticSpeechRecognitionPipeline.getInstance();

  let startTime;
  let numTokens = 0;
  let tps;
  const token_callback_function = () => {
    startTime ??= performance.now();

    if (numTokens++ > 0) {
      tps = (numTokens / (performance.now() - startTime)) * 1000;
    }
  };
  const callback_function = (output) => {
    self.postMessage({
      status: "update",
      output,
      tps,
      numTokens,
    });
  };

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function,
    token_callback_function,
  });

  const inputs = await processor(audio);

  const outputs = await model.generate({
    ...inputs,
    max_new_tokens: MAX_NEW_TOKENS,
    language,
    streamer,
  });

  const decoded = tokenizer.batch_decode(outputs, {
    skip_special_tokens: true,
  });

  // Send the output back to the main thread
  self.postMessage({
    status: "complete",
    output: decoded,
  });
  processing = false;
}

async function polishText({ text }) {
  // Tell the main thread we are starting polishing
  self.postMessage({ status: "polishing" });

  // Retrieve the text-polishing pipeline
  const [tokenizer, model] = await TextPolishingPipeline.getInstance();

  // Get the thinking tokens
  const [START_THINKING_TOKEN_ID, END_THINKING_TOKEN_ID] = tokenizer.encode(
    "<think></think>",
    { add_special_tokens: false },
  );

  // Create a prompt that encourages the model to use thinking tokens
  const prompt = `Transform the following transcribed voice note into a clear, concise, and readable summary suitable for written communication, such as messages, emails, or blog posts. Follow these steps:
Clean the Transcript:
- Remove filler words like 'um,' 'ah,' 'you know,' etc.
- Correct any grammatical errors and fix incomplete sentences.
- Ensure the text flows smoothly and is easy to read.

Summarize the Content:
- Identify and capture the main points and key ideas from the transcript.
- Rephrase the content into a concise and coherent narrative.
- Present the summary in a paragraph format (or specify another format if needed, such as bullet points for quick notes).
- Maintain the original tone and intent, but adjust the style to be suitable for written communication.

Ensure Accuracy:
- Base the summary solely on the provided transcript without adding external information or assumptions.
- Preserve the original meaning and key details.

Additional Instructions (Optional):
- If the summary is for a specific use (e.g., email, blog post), adjust the tone and format accordingly.
- For longer transcripts, focus on high-level points unless detailed information is requested.
- If the voice note contains technical terms or specific jargon, ensure they are retained in the summary.
  
Example:
Input: Hello, hello, hello. I'm going to introduce Voice Input Plus. It's an AI-powered voice-to-polish text tool. It's running completely locally using your own CPU or GPU or whatever. And yeah, you can just open your browser and run it.
Output: Hello! Let me tell you about Voice Input Plus. It's a smart tool that turns your spoken words into polished text. The best part? It works right on your computer using your CPU or GPU. Just open your browser and start using it!

Now given this original text: ${text}
<think>`;

  // Track the state (thinking or answering)
  let state = "thinking"; // 'thinking' or 'answering'
  let startTime;
  let numTokens = 0;
  let tps;
  let finalOutput = "";
  
  const token_callback_function = (tokens) => {
    startTime ??= performance.now();

    if (numTokens++ > 0) {
      tps = (numTokens / (performance.now() - startTime)) * 1000;
    }
    
    if (tokens[0] === END_THINKING_TOKEN_ID) {
      state = "answering";
    }
  };
  
  const callback_function = (output) => {
    if (state === "answering") {
      finalOutput = output;
    }
  };

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function,
    token_callback_function,
  });

  const outputs = await model.generate({
    ...tokenizer(prompt, { return_tensors: "pt" }),
    max_new_tokens: 2048,
    temperature: 0.1,
    top_p: 0.9,
    streamer,
  });

  // If the streamer approach didn't capture the output correctly, fall back to manual extraction
  if (!finalOutput || finalOutput.trim() === "") {
    const decoded = tokenizer.decode(outputs[0], {
      skip_special_tokens: true,
    });
    
    // Try to extract content after the thinking section
    const parts = decoded.split("</think>");
    if (parts.length > 1) {
      finalOutput = parts[1].trim();
    } else {
      finalOutput = decoded;
    }
  }

  // Remove any text within square brackets using regex
  finalOutput = finalOutput.replace(/\[[^\]]*\]/g, "");
  
  // Clean up any double spaces that might have been created by removing the tags
  finalOutput = finalOutput.replace(/\s+/g, " ").trim();

  // Send the polished text back to the main thread
  self.postMessage({
    status: "polished",
    polishedText: finalOutput,
  });
}

async function load() {
  self.postMessage({
    status: "loading",
    data: "Loading transcription model...",
  });

  // Load the whisper pipeline
  const [tokenizer, processor, model] =
    await AutomaticSpeechRecognitionPipeline.getInstance((x) => {
      // We also add a progress callback to the pipeline so that we can
      // track model loading.
      self.postMessage(x);
    });

  self.postMessage({
    status: "loading",
    data: "Loading DeepSeek text polishing model...",
  });

  // Load the text polishing pipeline
  await TextPolishingPipeline.getInstance((x) => {
    self.postMessage(x);
  });

  self.postMessage({
    status: "loading",
    data: "Compiling shaders and warming up models...",
  });

  // Run model with dummy input to compile shaders
  await model.generate({
    input_features: full([1, 80, 3000], 0.0),
    max_new_tokens: 1,
  });
  self.postMessage({ status: "ready" });
}

// Listen for messages from the main thread
self.addEventListener("message", async (e) => {
  const { type, data } = e.data;

  switch (type) {
    case "load":
      load();
      break;

    case "generate":
      generate(data);
      break;
      
    case "polish":
      polishText(data);
      break;
  }
});
