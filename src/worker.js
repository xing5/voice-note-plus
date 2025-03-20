import {
  AutoTokenizer,
  AutoProcessor,
  WhisperForConditionalGeneration,
  TextStreamer,
  AutoModelForCausalLM,
  InterruptableStoppingCriteria,
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
 * Text polishing pipeline using Llama 3.2 model
 */
class TextPolishingPipeline {
  static model_id = "onnx-community/Llama-3.2-1B-Instruct-q4f16";
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

const stopping_criteria = new InterruptableStoppingCriteria();

let processing = false;
async function generate({ audio, language }) {
  if (processing) return;
  processing = true;

  try {
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
    })[0];

    // Send the output back to the main thread
    self.postMessage({
      status: "complete",
      output: decoded.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, ''),
    });
  } catch (error) {
    console.error("Error during speech recognition:", error);
    self.postMessage({
      status: "error",
      error: error.message || "Error during speech recognition"
    });
  } finally {
    processing = false;
  }
}

async function polishText({ text }) {
  // Tell the main thread we are starting polishing
  self.postMessage({ status: "polishing" });
  
  // Retrieve the text-polishing pipeline.
  const [tokenizer, model] = await TextPolishingPipeline.getInstance();

  // Create a structured prompt for Llama 3.2 Instruct model with very clear instructions
  const messages = [
    {
      role: "system",
      content: `You are a voice note assistant. Your task is to process raw transcribed text into structured notes.
      
      For any input text, you MUST return a valid JSON object with the following fields:
      1. "title": A concise, descriptive title that captures the essence of the note (max 60 characters)
      2. "category": A single category that best describes the note (e.g., "Work", "Personal", "Ideas", "To-do", "Health", "Finance", "Learning")
      3. "tags": An array of 1-5 relevant tags as strings
      4. "content": The polished version of the input text with improved grammar, structure, and clarity
      
      For the content, remove filler words, fix grammar issues, improve flow, and restructure as needed to create clear, organized text.
      
      Your response MUST be ONLY the JSON object, with no additional text, explanations, or markdown formatting.
      The JSON must be valid and properly formatted.`
    },
    {
      role: "user",
      content: "Hello, hello, hello. I'm going to introduce Voice Input Plus. It's an AI-powered voice-to-polish text tool. It's running completely locally using your own CPU or GPU or whatever. And yeah, you can just open your browser and run it."
    },
    {
      role: "assistant",
      content: `{
  "title": "Introduction to Voice Input Plus",
  "category": "Technology",
  "tags": ["AI", "Voice Recognition", "Local Processing", "Tools"],
  "content": "Hello! Let me tell you about Voice Input Plus. It's a smart tool that turns your spoken words into polished text. The best part? It works right on your computer using your CPU or GPU. Just open your browser and start using it!"
}`
    },
    {
      role: "user",
      content: "The other day I have an idea which is to create a memory capsule app. What it does is that you can throw in any text, images, videos, and you can even have a conversation with an AI assistant. He will try to poke you with questions, trying to dig out your deep thoughts and some little details of your emotions, whatever that is hard to express if you are on your own. Then capture all these things into a capsule which can be transformed into any content if needed. For example, it can be converted into a blog post, a TikTok share, Instagram post, etc. In the future, it's going to be super powerful that you might talk to a past yourself and you might immerse yourself into an old memory using new technology in the future. But at first, you need to start documenting your memory. That's why memory capsule is so important right now."
    },
    {
      role: "assistant",
      content: `{
  "title": "Memory Capsule App Concept",
  "category": "Ideas",
  "tags": ["App Concept", "AI Assistant", "Memory Preservation", "Content Creation"],
  "content": "I recently had an idea for a memory capsule app. This app lets you save text, images, and videos. You can even chat with an AI assistant that asks questions to help you explore your thoughts and feelings, especially those that are hard to express alone. These memories can then be transformed into various content formats like blog posts, TikTok videos, or Instagram posts. In the future, this technology could allow you to interact with your past self and immerse yourself in old memories using advanced technology. The key is to start documenting your memories now, which is why this memory capsule concept is so important."
}`
    },
    {
      role: "user",
      content: text
    },
  ];

  // Apply the chat template to format the messages for the model
  const inputs = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    return_dict: true,
  });

  let startTime;
  let numTokens = 0;
  let tps;
  let finalOutput = "";

  const token_callback_function = (tokens) => {
    startTime ??= performance.now();

    if (numTokens++ > 0) {
      tps = (numTokens / (performance.now() - startTime)) * 1000;
    }
  };
  
  const callback_function = (token) => {
    finalOutput += token;
    // Send the accumulated output back to the main thread without any cleaning
    self.postMessage({
      status: "polishing_update",
      polishedText: token,
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

  try {
    await model.generate({
      ...inputs,
      do_sample: false,
      max_new_tokens: 1024,
      streamer,
      stopping_criteria,
      return_dict_in_generate: true,
    });

    // Parse the JSON output and validate its structure
    try {
      const jsonOutput = JSON.parse(finalOutput);
      
      // Validate that the JSON has all required fields
      if (!jsonOutput.title || !jsonOutput.category || !Array.isArray(jsonOutput.tags) || !jsonOutput.content) {
        throw new Error("Invalid JSON structure");
      }
      
      // Add a small delay before sending the final structured result
      setTimeout(() => {
        self.postMessage({
          status: "polished",
          polishedText: jsonOutput.content,
          noteData: {
            title: jsonOutput.title,
            category: jsonOutput.category,
            tags: jsonOutput.tags,
            content: jsonOutput.content
          }
        });
      }, 300);
    } catch (jsonError) {
      console.error("Error parsing JSON:", jsonError, "Raw output:", finalOutput);
      
      // Fallback: If JSON parsing fails, return the raw output as the content
      self.postMessage({
        status: "polished",
        polishedText: finalOutput,
        noteData: {
          title: "Untitled Note",
          category: "Uncategorized",
          tags: ["auto-generated"],
          content: finalOutput
        }
      });
    }
  } catch (error) {
    console.error("Error during text polishing:", error);
    
    // Send an error message back to the main thread
    self.postMessage({
      status: "polished",
      polishedText: "Error polishing text. Please try again.",
      noteData: {
        title: "Error Processing Note",
        category: "Uncategorized",
        tags: ["error"],
        content: "Error polishing text. Please try again."
      }
    });
  }
}

async function load() {
  // If models are already loaded, don't try to load them again
  if (AutomaticSpeechRecognitionPipeline.model !== null && 
      TextPolishingPipeline.model !== null) {
    self.postMessage({ status: "ready" });
    return;
  }

  try {
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
      data: "Loading Llama 3.2 text polishing model...",
    });

    // Load the text polishing pipeline
    await TextPolishingPipeline.getInstance((x) => {
      self.postMessage(x);
    });

    self.postMessage({
      status: "loading",
      data: "Compiling shaders and warming up models...",
    });

    try {
      // Run model with dummy input to compile shaders
      await model.generate({
        input_features: full([1, 80, 3000], 0.0),
        max_new_tokens: 1,
      });
      self.postMessage({ status: "ready" });
    } catch (error) {
      console.error("Error during model warmup:", error);
      // If warmup fails, we still consider the model ready
      self.postMessage({ status: "ready" });
    }
  } catch (error) {
    console.error("Error loading models:", error);
    self.postMessage({ 
      status: "error", 
      error: error.message || "Failed to load models" 
    });
  }
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
      
    case "interrupt":
      stopping_criteria.interrupt();
      break;
  }
});
