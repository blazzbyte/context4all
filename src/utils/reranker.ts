/**
 * Utility functions for reranking search results using Cohere
 */
import { CohereClient } from 'cohere-ai';

// Variable to hold the Cohere client instance
let cohereClient: CohereClient | null = null;

/**
 * Initialize the Cohere client with an API key
 * 
 * @param apiKey Cohere API key
 * @returns The initialized Cohere client
 */
export function initCohere(apiKey: string): CohereClient {
  cohereClient = new CohereClient({
    token: apiKey,
  });
  return cohereClient;
}

/**
 * Get the current Cohere client instance, or throw an error if not initialized
 * 
 * @returns The Cohere client instance
 */
export function getCohereClient(): CohereClient {
  if (!cohereClient) {
    throw new Error('Cohere client not initialized. Call initCohere first.');
  }
  return cohereClient;
}

/**
 * Interface for search result objects
 */
export interface SearchResult {
  [key: string]: any;
  rerank_score?: number;
}

/**
 * Rerank search results using Cohere's rerank API
 * 
 * @param query The search query
 * @param results List of search results
 * @param contentKey The key in each result object that contains the text content
 * @param modelName The Cohere rerank model to use
 * @param topN Optional number of top results to return (default: all results)
 * @returns Reranked list of results
 */
export async function rerankResults(
  query: string,
  results: SearchResult[],
  contentKey: string = "content",
  modelName: string = "rerank-multilingual-v3.0",
  topN?: number
): Promise<SearchResult[]> {
  if (!results || results.length === 0) {
    return results;
  }
  
  try {
    const client = getCohereClient();
    
    // Extract content from results
    const documents = results.map(result => result[contentKey] || "");
    
    // Get relevance scores from Cohere's rerank API
    const response = await client.rerank({
      model: modelName,
      query,
      documents,
      topN: topN || documents.length // If topN is not provided, rerank all results
    });
    
    // Create a new array with reranked results
    const reranked: SearchResult[] = [];
    
    // Process the reranked results
    if (response && response.results) {
      for (const rankedResult of response.results) {
        const index = rankedResult.index;
        const originalResult = { ...results[index] }; // Create a copy of the original result
        
        // Add rerank score to the result
        originalResult.rerank_score = rankedResult.relevanceScore;
        
        reranked.push(originalResult);
      }
    }
    
    return reranked;
  } catch (error) {
    console.error(`Error during reranking: ${error}`);
    return results; // Return original results in case of error
  }
}

/**
 * Rerank search results and merge with original results
 * 
 * This version preserves all original fields and just adds rerank scores and reorders
 * 
 * @param query The search query
 * @param results List of search results
 * @param contentKey The key in each result object that contains the text content
 * @param modelName The Cohere rerank model to use
 * @returns Reranked list of results
 */
export async function rerankAndMergeResults(
  query: string,
  results: SearchResult[],
  contentKey: string = "content",
  modelName: string = "rerank-multilingual-v3.0"
): Promise<SearchResult[]> {
  if (!results || results.length === 0) {
    return results;
  }
  
  try {
    const client = getCohereClient();
    
    // Extract content from results
    const documents = results.map(result => result[contentKey] || "");
    
    // Get relevance scores from Cohere's rerank API
    const response = await client.rerank({
      model: modelName,
      query,
      documents
    });
    
    // Add scores to the original results
    if (response && response.results) {
      for (const rankedResult of response.results) {
        const index = rankedResult.index;
        if (index >= 0 && index < results.length) {
          results[index].rerank_score = rankedResult.relevanceScore;
        }
      }
    }
    
    // Sort by rerank score (descending)
    return [...results].sort((a, b) => 
      (b.rerank_score || 0) - (a.rerank_score || 0)
    );
  } catch (error) {
    console.error(`Error during reranking: ${error}`);
    return results; // Return original results in case of error
  }
}