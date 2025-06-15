import { Client } from "langsmith";
import { traceable } from "langsmith/traceable";

/**
 * Log search results as a retriever operation in LangSmith
 * 
 * @param query Search query
 * @param results Search results
 * @param metadata Additional metadata
 * @param client LangSmith client
 * @param projectName Optional project name
 * @returns The original results (unchanged)
 */
export async function logRetrieverResults(
  query: string,
  results: any[],
  metadata: Record<string, any>,
  client: Client,
  projectName?: string
): Promise<any[]> {
  // Create a traceable function that formats results according to LangSmith's requirements
  const retrieverLogger = traceable(
    (query: string) => {
      // Format results as Document objects for LangSmith retriever rendering
      return results.map(doc => ({
        page_content: doc.content,
        type: "Document",
        metadata: {
          user_id: metadata.user_id,
          search_mode: metadata.search_mode,
          model_embedding: metadata.model_embedding,
          word_count: doc.metadata.word_count,
          char_count: doc.metadata.char_count,
          chunk_size: doc.metadata.chunk_size,
          line_count: doc.metadata.line_count,
          chunk_index: doc.metadata.chunk_index,
          url: doc.url,
          source_id: doc.source_id,
          similarity: doc.similarity,
          crawl_time: doc.metadata.crawl_time,
          extracted_at: doc.metadata.extracted_at
        }
      }));
    },
    {
      name: "documentRetriever",
      run_type: "retriever",
      client: client,
      tracingEnabled: true,
      project_name: projectName || "Testing"
    }
  );

  // Execute the traceable function to log the retrieval
  await retrieverLogger(query);

  // Return the original results unchanged
  return results;
}

/**
 * Log code example search results as a retriever operation in LangSmith
 * 
 * @param query Search query
 * @param results Code example search results
 * @param metadata Additional metadata
 * @param client LangSmith client
 * @param projectName Optional project name
 * @returns The original results (unchanged)
 */
export async function logCodeExampleRetrieverResults(
  query: string,
  results: any[],
  metadata: Record<string, any>,
  client: Client,
  projectName?: string
): Promise<any[]> {
  // Create a traceable function that formats code examples for LangSmith
  const codeRetrieverLogger = traceable(
    (query: string) => {
      // Format results as Document objects for LangSmith retriever rendering
      return results.map(doc => ({
        page_content: doc.content, // The code content
        type: "Document",
        metadata: {
          user_id: metadata.user_id,
          search_mode: metadata.search_mode,
          model_embedding: metadata.model_embedding,
          url: doc.url,
          source_id: doc.source_id,
          similarity: doc.similarity,
          summary: doc.summary || "No summary available",
          language: doc.metadata?.language || "unknown",
          code_type: "example"
        }
      }));
    },
    {
      name: "codeExampleRetriever",
      run_type: "retriever",
      client: client,
      tracingEnabled: true,
      project_name: projectName || "CodeExamples"
    }
  );

  // Execute the traceable function to log the retrieval
  await codeRetrieverLogger(query);
  
  // Return the original results unchanged
  return results;
} 