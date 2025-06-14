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
    batchSize: number = 20
  ): Promise<void> {
    // Get unique URLs to delete existing records
    const uniqueUrls = [...new Set(urls)];
    
    // Delete existing records for these URLs in a single operation
    try {
      if (uniqueUrls.length > 0) {
        await client.from("crawled_pages").delete().in("url", uniqueUrls);
      }
    } catch (e) {
      console.log(`Batch delete failed: ${e}. Trying one-by-one deletion as fallback.`);
      // Fallback: delete records one by one
      for (const url of uniqueUrls) {
        try {
          await client.from("crawled_pages").delete().eq("url", url);
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
        const sourceId = parsedUrl.hostname || parsedUrl.pathname;
        
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
          embedding: batchEmbeddings[j]
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