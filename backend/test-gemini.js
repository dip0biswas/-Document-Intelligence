import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;

  if (!apiKey) {
    console.log("FAILED: GEMINI_API_KEY is missing");
    return;
  }

  if (!model) {
    console.log("FAILED: GEMINI_MODEL is missing");
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    console.log("Testing Gemini connection...");
    console.log("Model:", model);

    const result = await ai.models.generateContent({
      model,
      contents: "Reply with exactly: GEMINI CONNECTED",
    });

    console.log("SUCCESS: Gemini is connected!");
    console.log("Response:", result.text);
  } catch (error) {
    console.log("GEMINI CONNECTION FAILED");
    console.log("Status:", error.status || error.code);
    console.log("Error:", error.message);
  }
}

testGemini();