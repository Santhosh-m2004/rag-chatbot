import Groq from "groq-sdk";

// Initialize Groq client
function getClient() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

// Generate response from Groq API
export async function generateResponse(prompt) {
  try {
    const client = getClient();
    
    const completion = await client.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 1000
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Groq API error:', error);
    throw new Error(`Failed to generate response: ${error.message}`);
  }
}