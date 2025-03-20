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
  processing = false;
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
      content: `You are a voice note assistant. Your task is to convert the rambled messy thoughts into clear text. 
      Please remove any filler words, fix grammar, and improve flow, restructure the text to make it clear.
      This is not a conversation. You must output ONLY the polished text, with absolutely no additional commentary, explanations, or formatting.
      Please follow the examples below to understand how to polish the text.`
    },
    {
      role: "user",
      content: "Hello, hello, hello. I'm going to introduce Voice Input Plus. It's an AI-powered voice-to-polish text tool. It's running completely locally using your own CPU or GPU or whatever. And yeah, you can just open your browser and run it."
    },
    {
      role: "assistant",
      content: "Hello! Let me tell you about Voice Input Plus. It's a smart tool that turns your spoken words into polished text. The best part? It works right on your computer using your CPU or GPU. Just open your browser and start using it!"
    },
    {
      role: "user",
      content: "The other day I have an idea which is to create a memory capsule app. What it does is that you can throw in any text, images, videos, and you can even have a conversation with an AI assistant. He will try to poke you with questions, trying to dig out your deep thoughts and some little details of your emotions, whatever that is hard to express if you are on your own. Then capture all these things into a capsule which can be transformed into any content if needed. For example, it can be converted into a blog post, a TikTok share, Instagram post, etc. In the future, it's going to be super powerful that you might talk to a past yourself and you might immerse yourself into an old memory using new technology in the future. But at first, you need to start documenting your memory. That's why memory capsule is so important right now."
    },
    {
      role: "assistant",
      content: "I recently had an idea for a memory capsule app. This app lets you save text, images, and videos. You can even chat with an AI assistant. The AI will ask questions to help you explore your thoughts and feelings, especially those that are hard to express alone."
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

    self.postMessage({
      status: "polished",
      polishedText: finalOutput,
    });
  } catch (error) {
    console.error("Error during text polishing:", error);
    
    // Send an error message back to the main thread
    self.postMessage({
      status: "polished",
      polishedText: "Error polishing text. Please try again.",
    });
  }
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
      
    case "interrupt":
      stopping_criteria.interrupt();
      break;
  }
});
