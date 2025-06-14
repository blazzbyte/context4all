import OpenAI from 'openai';

/**
 * Create embeddings for multiple texts in a single API call
 * 
 * @param texts List of texts to create embeddings for
 * @param openaiClient OpenAI client instance
 * @param modelEmbedding Model to use for embeddings (optional)
 * @returns List of embeddings (each embedding is an array of floats)
 */
export async function createEmbeddingsBatch(
  texts: string[],
  openaiClient: OpenAI,
  modelEmbedding: string = "baai/bge-m3"
): Promise<number[][]> {
  if (!texts || texts.length === 0) {
    return [];
  }

  if (!openaiClient) {
    console.log("No OpenAI client provided for embeddings, returning zero embeddings");
    return texts.map(() => new Array(1024).fill(0));
  }
  
  const maxRetries = 1;
  let retryDelay = 1000; // Start with 1 second delay (in milliseconds)
  
  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      const response = await openaiClient.embeddings.create({
        model: modelEmbedding, // Use the provided model name
        input: texts,
        dimensions: 1024
      });
      
      return response.data.map(item => item.embedding);
    } catch (e) {
      if (retry < maxRetries - 1) {
        console.log(`Error creating batch embeddings (attempt ${retry + 1}/${maxRetries}): ${e}`);
        console.log(`Retrying in ${retryDelay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        retryDelay *= 2; // Exponential backoff
      } else {
        console.log(`Failed to create batch embeddings after ${maxRetries} attempts: ${e}`);
        // Try creating embeddings one by one as fallback
        console.log("Attempting to create embeddings individually...");
        const embeddings: number[][] = [];
        let successfulCount = 0;
        
        for (let i = 0; i < texts.length; i++) {
          try {
            const individualResponse = await openaiClient.embeddings.create({
              model: modelEmbedding,
              input: [texts[i]]
            });
            embeddings.push(individualResponse.data[0].embedding);
            successfulCount++;
          } catch (individualError) {
            console.log(`Failed to create embedding for text ${i}: ${individualError}`);
            // Add zero embedding as fallback (assuming 1024 dimensions for baai/bge-m3)
            embeddings.push(new Array(1024).fill(0));
          }
        }
        
        console.log(`Successfully created ${successfulCount}/${texts.length} embeddings individually`);
        return embeddings;
      }
    }
  }
  
  return []; // This should never be reached due to the final catch block above
}

/**
 * Create an embedding for a single text using OpenAI's API
 * 
 * @param text Text to create an embedding for
 * @param openaiClient OpenAI client instance
 * @param modelEmbedding Model to use for embeddings (optional)
 * @returns Array of floats representing the embedding
 */
export async function createEmbedding(
  text: string,
  openaiClient: OpenAI,
  modelEmbedding: string = "baai/bge-m3"
): Promise<number[]> {
  try {
    const embeddings = await createEmbeddingsBatch([text], openaiClient, modelEmbedding);
    return embeddings[0] || new Array(1024).fill(0);
  } catch (e) {
    console.log(`Error creating embedding: ${e}`);
    // Return empty embedding if there's an error (assuming 1024 dimensions)
    return new Array(1024).fill(0);
  }
}

/**
 * Generate contextual information for a chunk within a document to improve retrieval
 * 
 * @param fullDocument The complete document text
 * @param chunk The specific chunk of text to generate context for
 * @param openaiClient OpenAI client instance
 * @param modelChoice Model to use for contextual generation (optional)
 * @returns Tuple containing the contextual text and a boolean indicating if contextual embedding was performed
 */
export async function generateContextualEmbedding(
  fullDocument: string, 
  chunk: string,
  openaiClient: OpenAI,
  modelChoice: string = "gpt-3.5-turbo"
): Promise<[string, boolean]> {
  if (!openaiClient) {
    return [chunk, false];
  }
  
  try {
    // Create the prompt for generating contextual information
    const prompt = `<document> 
${fullDocument.substring(0, 25000)} 
</document>
Here is the chunk we want to situate within the whole document 
<chunk> 
${chunk}
</chunk> 
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`;

    // Call the OpenAI API to generate contextual information
    const response = await openaiClient.chat.completions.create({
      model: modelChoice,
      messages: [
        { role: "system", content: "You are a helpful assistant that provides concise contextual information." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 200
    });
    
    // Extract the generated context
    const context = response.choices[0].message.content?.trim() || "";
    
    // Combine the context with the original chunk
    const contextualText = `${context}\n---\n${chunk}`;
    
    return [contextualText, true];
  } catch (e) {
    console.log(`Error generating contextual embedding: ${e}. Using original chunk instead.`);
    return [chunk, false];
  }
}

/**
 * Process a single chunk with contextual embedding
 * 
 * @param url The URL of the document
 * @param content The content of the chunk
 * @param fullDocument The full document text
 * @param openaiClient OpenAI client instance
 * @param modelChoice Model to use for contextual generation (optional)
 * @returns Tuple containing the contextual text and a boolean indicating if contextual embedding was performed
 */
export async function processChunkWithContext(
  url: string, 
  content: string, 
  fullDocument: string,
  openaiClient: OpenAI,
  modelChoice?: string
): Promise<[string, boolean]> {
  return generateContextualEmbedding(fullDocument, content, openaiClient, modelChoice);
}