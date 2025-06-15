import { SupabaseClient } from '@supabase/supabase-js';
import { URL } from 'url';
import { createEmbedding, createEmbeddingsBatch, processChunkWithContext } from './embeddings';
import OpenAI from 'openai';

/**
 * Add documents to the Supabase crawled_pages table in batches
 * 
 * @param client Supabase client
 * @param urls List of URLs
 * @param chunkNumbers List of chunk numbers
 * @param contents List of document contents
 * @param metadatas List of document metadata
 * @param urlToFullDocument Dictionary mapping URLs to their full document content
 * @param openaiClient OpenAI client instance
 * @param modelEmbedding Model to use for embeddings
 * @param useContextualEmbeddings Whether to use contextual embeddings
 * @param modelChoice Model to use for contextual generation
 * @param userId User ID to associate with the documents
 * @param batchSize Size of each batch for insertion
 */
export async function addDocumentsToSupabase(
  client: SupabaseClient,
  urls: string[],
  chunkNumbers: number[],
  contents: string[],
  metadatas: Record<string, any>[],
  urlToFullDocument: Record<string, string>,
  openaiClient: OpenAI,
  modelEmbedding?: string,
  useContextualEmbeddings: boolean = false,
  modelChoice?: string,
  userId?: string,
  batchSize: number = 20
): Promise<void> {
  // Get unique URLs to delete existing records
  const uniqueUrls = [...new Set(urls)];

  // Delete existing records for these URLs in a single operation
  try {
    if (uniqueUrls.length > 0) {
      let deleteQuery = client.from("crawled_pages").delete().in("url", uniqueUrls);
      
      // Only delete documents for this user if userId is provided
      if (userId) {
        deleteQuery = deleteQuery.eq("user_id", userId);
      }
      
      await deleteQuery;
    }
  } catch (e) {
    console.log(`Batch delete failed: ${e}. Trying one-by-one deletion as fallback.`);
    // Fallback: delete records one by one
    for (const url of uniqueUrls) {
      try {
        let deleteQuery = client.from("crawled_pages").delete().eq("url", url);
        
        // Only delete documents for this user if userId is provided
        if (userId) {
          deleteQuery = deleteQuery.eq("user_id", userId);
        }
        
        await deleteQuery;
      } catch (innerE) {
        console.log(`Error deleting record for URL ${url}: ${innerE}`);
        // Continue with the next URL even if one fails
      }
    }
  }

  console.log(`\n\nUse contextual embeddings: ${useContextualEmbeddings}\n\n`);

  // Process in batches to avoid memory issues
  for (let i = 0; i < contents.length; i += batchSize) {
    const batchEnd = Math.min(i + batchSize, contents.length);

    // Get batch slices
    const batchUrls = urls.slice(i, batchEnd);
    const batchChunkNumbers = chunkNumbers.slice(i, batchEnd);
    const batchContents = contents.slice(i, batchEnd);
    const batchMetadatas = metadatas.slice(i, batchEnd);

    // Apply contextual embedding to each chunk if enabled and OpenAI client is available
    let contextualContents: string[] = [];

    if (useContextualEmbeddings && openaiClient) {
      // Process chunks in parallel
      const processPromises = batchContents.map((content, j) => {
        const url = batchUrls[j];
        const fullDocument = urlToFullDocument[url] || "";
        return processChunkWithContext(url, content, fullDocument, openaiClient, modelChoice);
      });

      // Wait for all processing to complete
      const results = await Promise.all(
        processPromises.map(p => p.catch(e => {
          console.log(`Error processing chunk: ${e}`);
          return ["", false] as [string, boolean];
        }))
      );

      // Extract results
      contextualContents = results.map((result, idx) => {
        const [text, success] = result;
        if (success) {
          batchMetadatas[idx].contextualEmbedding = true;
          return text;
        }
        // Use original content as fallback if processing failed
        return batchContents[idx];
      });
    } else {
      // If not using contextual embeddings, use original contents
      contextualContents = batchContents;
    }

    // Create embeddings for the entire batch at once
    const batchEmbeddings = await createEmbeddingsBatch(contextualContents, openaiClient, modelEmbedding);

    const batchData = [];
    for (let j = 0; j < contextualContents.length; j++) {
      // Extract metadata fields
      const chunkSize = contextualContents[j].length;

      // Extract source_id from URL
      const parsedUrl = new URL(batchUrls[j]);
      // Remove "www." prefix to match the logic in metadata.ts
      const sourceId = (parsedUrl.hostname || parsedUrl.pathname).replace(/^www\./, '');

      // Prepare data for insertion
      const data = {
        url: batchUrls[j],
        chunk_number: batchChunkNumbers[j],
        content: contextualContents[j],
        metadata: {
          chunk_size: chunkSize,
          ...batchMetadatas[j]
        },
        source_id: sourceId,
        embedding: batchEmbeddings[j],
        user_id: userId // Add user_id to the data
      };

      batchData.push(data);
    }

    // Insert batch into Supabase with retry logic
    const maxRetries = 3;
    let retryDelay = 1000; // Start with 1 second delay (in milliseconds)

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        await client.from("crawled_pages").insert(batchData);
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
              await client.from("crawled_pages").insert(record);
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
  }
}

/**
 * Search for documents in Supabase using vector similarity
 * 
 * @param client Supabase client
 * @param query Query text
 * @param openaiClient OpenAI client instance
 * @param modelEmbedding Model to use for embeddings
 * @param matchCount Maximum number of results to return
 * @param filterMetadata Optional metadata filter
 * @returns List of matching documents
 */
export async function searchDocuments(
  client: SupabaseClient,
  query: string,
  openaiClient: OpenAI,
  modelEmbedding?: string,
  matchCount: number = 10,
  filterMetadata?: Record<string, any>
): Promise<any[]> {
  // Create embedding for the query
  const queryEmbedding = await createEmbedding(query, openaiClient, modelEmbedding);

  // Execute the search using the match_crawled_pages function
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

    const result = await client.rpc('match_crawled_pages', params);

    return result.data || [];
  } catch (e) {
    console.log(`Error searching documents: ${e}`);
    return [];
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
* @param userId User ID to associate with the code examples
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
  userId?: string,
  batchSize: number = 20
): Promise<void> {
  if (!urls || urls.length === 0) {
    return;
  }

  // Delete existing records for these URLs
  const uniqueUrls = [...new Set(urls)];
  for (const url of uniqueUrls) {
    try {
      let deleteQuery = client.from('code_examples').delete().eq('url', url);
      
      // Only delete code examples for this user if userId is provided
      if (userId) {
        deleteQuery = deleteQuery.eq("user_id", userId);
      }
      
      await deleteQuery;
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
      // Remove "www." prefix to match the logic in addDocumentsToSupabase
      const sourceId = (parsedUrl.hostname || parsedUrl.pathname).replace(/^www\./, '');

      batchData.push({
        url: urls[idx],
        chunk_number: chunkNumbers[idx],
        content: codeExamples[idx],
        summary: summaries[idx],
        metadata: metadatas[idx],
        source_id: sourceId,
        embedding: validEmbeddings[j],
        user_id: userId // Add user_id to the data
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
 * @param userId Optional user ID to filter results
 * @returns List of matching code examples
 */
export async function searchCodeExamples(
  client: SupabaseClient,
  query: string,
  openaiClient: OpenAI,
  modelEmbedding?: string,
  matchCount: number = 10,
  filterMetadata?: Record<string, any>,
  sourceId?: string,
  userId?: string
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
    
    // Add user filter if provided
    if (userId) {
      params.user_filter = userId;
    }

    const result = await client.rpc('match_code_examples', params);

    return result.data || [];
  } catch (e) {
    console.log(`Error searching code examples: ${e}`);
    return [];
  }
}