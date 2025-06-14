/**
 * Utilities for handling code examples and blocks
 */
import { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { URL } from 'url';
import { createEmbedding, createEmbeddingsBatch } from './embeddings';

/**
 * Process a single code example to generate its summary.
 * This function is designed to be used with Promise.all for parallel processing.
 * 
 * @param code The code example
 * @param contextBefore Context before the code
 * @param contextAfter Context after the code
 * @param openaiClient OpenAI client instance
 * @param modelChoice Model to use
 * @returns The generated summary
 */
export async function processCodeExample(
  code: string,
  contextBefore: string,
  contextAfter: string,
  openaiClient: OpenAI,
  modelChoice?: string
): Promise<string> {
  return generateCodeExampleSummary(code, contextBefore, contextAfter, openaiClient, modelChoice);
}

/**
 * Extract code blocks from markdown content along with context
 * 
 * @param markdownContent The markdown content to extract code blocks from
 * @param minLength Minimum length of code blocks to extract (default: 1000 characters)
 * @returns List of objects containing code blocks and their context
 */
export function extractCodeBlocks(
  markdownContent: string, 
  minLength: number = 1000
): Array<{
  code: string;
  language: string;
  context_before: string;
  context_after: string;
  full_context: string;
}> {
  const codeBlocks = [];
  
  // Skip if content starts with triple backticks (edge case for files wrapped in backticks)
  const content = markdownContent.trim();
  let startOffset = 0;
  if (content.startsWith('```')) {
    // Skip the first triple backticks
    startOffset = 3;
    console.log("Skipping initial triple backticks");
  }
  
  // Find all occurrences of triple backticks
  const backtickPositions: number[] = [];
  let pos = startOffset;
  while (true) {
    pos = markdownContent.indexOf('```', pos);
    if (pos === -1) {
      break;
    }
    backtickPositions.push(pos);
    pos += 3;
  }
  
  // Process pairs of backticks
  let i = 0;
  while (i < backtickPositions.length - 1) {
    const startPos = backtickPositions[i];
    const endPos = backtickPositions[i + 1];
    
    // Extract the content between backticks
    const codeSection = markdownContent.substring(startPos + 3, endPos);
    
    // Check if there's a language specifier on the first line
    const lines = codeSection.split('\n', 2);
    let language = "";
    let codeContent = "";
    
    if (lines.length > 1) {
      // Check if first line is a language specifier (no spaces, common language names)
      const firstLine = lines[0].trim();
      if (firstLine && !firstLine.includes(' ') && firstLine.length < 20) {
        language = firstLine;
        codeContent = lines.length > 1 ? lines[1].trim() : "";
      } else {
        language = "";
        codeContent = codeSection.trim();
      }
    } else {
      language = "";
      codeContent = codeSection.trim();
    }
    
    // Skip if code block is too short
    if (codeContent.length < minLength) {
      i += 2;  // Move to next pair
      continue;
    }
    
    // Extract context before (1000 chars)
    const contextStart = Math.max(0, startPos - 1000);
    const contextBefore = markdownContent.substring(contextStart, startPos).trim();
    
    // Extract context after (1000 chars)
    const contextEnd = Math.min(markdownContent.length, endPos + 3 + 1000);
    const contextAfter = markdownContent.substring(endPos + 3, contextEnd).trim();
    
    codeBlocks.push({
      code: codeContent,
      language: language,
      context_before: contextBefore,
      context_after: contextAfter,
      full_context: `${contextBefore}\n\n${codeContent}\n\n${contextAfter}`
    });
    
    // Move to next pair (skip the closing backtick we just processed)
    i += 2;
  }
  
  return codeBlocks;
}

/**
 * Generate a summary for a code example using its surrounding context
 * 
 * @param code The code example
 * @param contextBefore Context before the code
 * @param contextAfter Context after the code
 * @param openaiClient OpenAI client instance
 * @param modelChoice Model to use
 * @returns A summary of what the code example demonstrates
 */
export async function generateCodeExampleSummary(
  code: string, 
  contextBefore: string, 
  contextAfter: string,
  openaiClient: OpenAI,
  modelChoice?: string
): Promise<string> {
  if (!openaiClient) {
    return "Code example for demonstration purposes.";
  }
  
  // Create the prompt
  const prompt = `<context_before>
${contextBefore.length > 500 ? contextBefore.slice(-500) : contextBefore}
</context_before>

<code_example>
${code.length > 1500 ? code.substring(0, 1500) : code}
</code_example>

<context_after>
${contextAfter.length > 500 ? contextAfter.substring(0, 500) : contextAfter}
</context_after>

Based on the code example and its surrounding context, provide a concise summary (2-3 sentences) that describes what this code example demonstrates and its purpose. Focus on the practical application and key concepts illustrated.
`;
  
  try {
    const response = await openaiClient.chat.completions.create({
      model: modelChoice || "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant that provides concise code example summaries." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 100
    });
    
    return response.choices[0].message.content?.trim() || "Code example for demonstration purposes.";
  } catch (e) {
    console.log(`Error generating code example summary: ${e}`);
    return "Code example for demonstration purposes.";
  }
}

/**
 * Add code examples to the Supabase code_examples table in batches
 * 
 * @param client Supabase client
 * @param urls List of URLs
 * @param chunkNumbers List of chunk numbers
 * @param codeExamples List of code example contents
 * @param summaries List of code example summaries
 * @param metadatas List of metadata dictionaries
 * @param openaiClient OpenAI client instance
 * @param modelEmbedding Model to use for embeddings
 * @param batchSize Size of each batch for insertion
 */
export async function addCodeExamplesToSupabase(
  client: SupabaseClient,
  urls: string[],
  chunkNumbers: number[],
  codeExamples: string[],
  summaries: string[],
  metadatas: Record<string, any>[],
  openaiClient: OpenAI,
  modelEmbedding?: string,
  batchSize: number = 20
): Promise<void> {
  if (!urls || urls.length === 0) {
    return;
  }
  
  // Delete existing records for these URLs
  const uniqueUrls = [...new Set(urls)];
  for (const url of uniqueUrls) {
    try {
      await client.from('code_examples').delete().eq('url', url);
    } catch (e) {
      console.log(`Error deleting existing code examples for ${url}: ${e}`);
    }
  }
  
  // Process in batches
  const totalItems = urls.length;
  for (let i = 0; i < totalItems; i += batchSize) {
    const batchEnd = Math.min(i + batchSize, totalItems);
    const batchTexts: string[] = [];
    
    // Create combined texts for embedding (code + summary)
    for (let j = i; j < batchEnd; j++) {
      const combinedText = `${codeExamples[j]}\n\nSummary: ${summaries[j]}`;
      batchTexts.push(combinedText);
    }
    
    // Create embeddings for the batch
    const embeddings = await createEmbeddingsBatch(batchTexts, openaiClient, modelEmbedding);
    
    // Check if embeddings are valid (not all zeros)
    const validEmbeddings: number[][] = [];
    for (let j = 0; j < embeddings.length; j++) {
      const embedding = embeddings[j];
      if (embedding && !embedding.every(v => v === 0.0)) {
        validEmbeddings.push(embedding);
      } else {
        console.log("Warning: Zero or invalid embedding detected, creating new one...");
        // Try to create a single embedding as fallback
        const singleEmbedding = await createEmbedding(batchTexts[validEmbeddings.length], openaiClient, modelEmbedding);
        validEmbeddings.push(singleEmbedding);
      }
    }
    
    // Prepare batch data
    const batchData = [];
    for (let j = 0; j < validEmbeddings.length; j++) {
      const idx = i + j;
      
      // Extract source_id from URL
      const parsedUrl = new URL(urls[idx]);
      const sourceId = parsedUrl.hostname || parsedUrl.pathname;
      
      batchData.push({
        url: urls[idx],
        chunk_number: chunkNumbers[idx],
        content: codeExamples[idx],
        summary: summaries[idx],
        metadata: metadatas[idx],
        source_id: sourceId,
        embedding: validEmbeddings[j]
      });
    }
    
    // Insert batch into Supabase with retry logic
    const maxRetries = 3;
    let retryDelay = 1000; // Start with 1 second delay (in milliseconds)
    
    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        await client.from('code_examples').insert(batchData);
        // Success - break out of retry loop
        break;
      } catch (e) {
        if (retry < maxRetries - 1) {
          console.log(`Error inserting batch into Supabase (attempt ${retry + 1}/${maxRetries}): ${e}`);
          console.log(`Retrying in ${retryDelay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryDelay *= 2; // Exponential backoff
        } else {
          // Final attempt failed
          console.log(`Failed to insert batch after ${maxRetries} attempts: ${e}`);
          // Optionally, try inserting records one by one as a last resort
          console.log("Attempting to insert records individually...");
          let successfulInserts = 0;
          for (const record of batchData) {
            try {
              await client.from('code_examples').insert(record);
              successfulInserts++;
            } catch (individualError) {
              console.log(`Failed to insert individual record for URL ${record.url}: ${individualError}`);
            }
          }
          
          if (successfulInserts > 0) {
            console.log(`Successfully inserted ${successfulInserts}/${batchData.length} records individually`);
          }
        }
      }
    }
    console.log(`Inserted batch ${Math.floor(i / batchSize) + 1} of ${Math.floor((totalItems + batchSize - 1) / batchSize)} code examples`);
  }
}

/**
 * Search for code examples in Supabase using vector similarity
 * 
 * @param client Supabase client
 * @param query Query text
 * @param openaiClient OpenAI client instance
 * @param modelEmbedding Model to use for embeddings
 * @param matchCount Maximum number of results to return
 * @param filterMetadata Optional metadata filter
 * @param sourceId Optional source ID to filter results
 * @returns List of matching code examples
 */
export async function searchCodeExamples(
  client: SupabaseClient,
  query: string,
  openaiClient: OpenAI,
  modelEmbedding?: string,
  matchCount: number = 10,
  filterMetadata?: Record<string, any>,
  sourceId?: string
): Promise<any[]> {
  // Create a more descriptive query for better embedding match
  // Since code examples are embedded with their summaries, we should make the query more descriptive
  const enhancedQuery = `Code example for ${query}\n\nSummary: Example code showing ${query}`;
  
  // Create embedding for the enhanced query
  const queryEmbedding = await createEmbedding(enhancedQuery, openaiClient, modelEmbedding);
  
  // Execute the search using the match_code_examples function
  try {
    // Only include filter parameter if filterMetadata is provided and not empty
    const params: Record<string, any> = {
      query_embedding: queryEmbedding,
      match_count: matchCount
    };
    
    // Only add the filter if it's actually provided and not empty
    if (filterMetadata) {
      params.filter = filterMetadata;
    }
    
    // Add source filter if provided
    if (sourceId) {
      params.source_filter = sourceId;
    }
    
    const result = await client.rpc('match_code_examples', params);
    
    return result.data || [];
  } catch (e) {
    console.log(`Error searching code examples: ${e}`);
    return [];
  }
}
