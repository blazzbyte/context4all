import { z } from "zod";
import { experimental_PaidMcpAgent as PaidMcpAgent } from "@stripe/agent-toolkit/cloudflare";
import { WebCrawler } from "../utils/crawler";
import { getSupabaseClient } from "../utils/supabase";
import { extractSourceMetadata, updateSourceInfo, extractSourceSummary } from '../utils/metadata';
import { addDocumentsToSupabase, addCodeExamplesToSupabase } from '../utils/documents';
import { smartChunkMarkdown, extractSectionInfo } from '../utils/content_processor';
import { extractCodeBlocks, processCodeExample } from "../utils/code";
import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers";
import { Client } from "langsmith";

// Define LinkInfo interface to match the one in crawler.ts
interface LinkInfo {
  url: string;
  text: string;
  internal: boolean;
}

export function crawlSinglePageTool(
  agent: PaidMcpAgent<Env, any, any>,
  env?: {
    SUPABASE_URL: string;
    SUPABASE_SERVICE_KEY: string;
    BROWSERLESS_TOKEN: string;
    BROWSERLESS_URL: string;
    COHERE_API_KEY: string;
    USE_AGENTIC_RAG?: string;
    LLM_API_KEY?: string;
    LLM_API_URL?: string;
    MODEL_CHOICE?: string;
    MODEL_EMBEDDING?: string;
    USE_CONTEXTUAL_EMBEDDINGS?: string;
    LANGSMITH_API_KEY?: string;
    LANGSMITH_ENDPOINT?: string;
    LANGSMITH_PROJECT?: string;
  }
) {
  const server = agent.server;

  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_KEY || !env?.BROWSERLESS_TOKEN || !env?.COHERE_API_KEY) {
    throw new Error("Missing required environment variables");
  }

  // @ts-ignore
  server.tool(
    "crawl_single_page",
    "Crawl a single web page, extract its content, process it into chunks with embeddings, and store in the RAG system",
    {
      url: z.string().url().describe("The URL to crawl and extract content from"),
      chunk_size: z.number().optional().default(1000).describe("Size of each content chunk (default: 1000)"),
      chunk_overlap: z.number().optional().default(200).describe("Overlap between chunks (default: 200)")
    },
    async ({ url, chunk_size = 1000, chunk_overlap = 200 }: {
      url: string;
      chunk_size?: number;
      chunk_overlap?: number;
    }) => {
      try {
        // Initialize the web crawler with Browserless
        const crawler = new WebCrawler({
          browserlessToken: env.BROWSERLESS_TOKEN,
          browserlessUrl: env.BROWSERLESS_URL,
          timeout: 30000
        });

        // Crawl the URL
        const crawlResult = await crawler.crawl(url);

        if (!crawlResult.success) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Failed to crawl ${url}: ${crawlResult.error}`,
                url: url
              }, null, 2)
            }]
          };
        }

        // Get Supabase client
        const supabaseClient = getSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

        const langsmithClient = new Client({
          apiKey: env.LANGSMITH_API_KEY || "",
          apiUrl: env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com",
        });

        // Create OpenAI client if LLM API key is provided
        const openaiClient = wrapOpenAI(new OpenAI({
          apiKey: env.LLM_API_KEY,
          ...(env.LLM_API_URL && { baseURL: env.LLM_API_URL })
        }), {
          name: "crawl_single_page",
          run_type: "llm",
          client: langsmithClient,
          tracingEnabled: true,
          project_name: env.LANGSMITH_PROJECT || "Testing"
        });

        // Get model choices
        const modelChoice = env.MODEL_CHOICE || "gpt-3.5-turbo";
        const modelEmbedding = env.MODEL_EMBEDDING || "text-embedding-3-small";

        // Process the content
        try {
          if (!env.COHERE_API_KEY) {
            throw new Error('Cohere API key is required for embeddings');
          }

          // Extract metadata from URL
          const metadata = extractSourceMetadata({ url });
          const sourceId = metadata.domain;

          // Split content into chunks
          const content = crawlResult.markdown;
          const chunks = smartChunkMarkdown(content, chunk_size);

          if (chunks.length === 0) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: 'No chunks generated from content',
                  url: url
                }, null, 2)
              }]
            };
          }

          // Prepare data for addDocumentsToSupabase
          const urls: string[] = [];
          const chunkNumbers: number[] = [];
          const contents: string[] = [];
          const metadatas: Record<string, any>[] = [];
          let totalWordCount = 0;

          // Process each chunk with extractSectionInfo
          chunks.forEach((chunk, index) => {
            urls.push(url);
            chunkNumbers.push(index);
            contents.push(chunk);

            // Extract section info for this chunk
            const sectionInfo = extractSectionInfo(chunk);
            totalWordCount += sectionInfo.word_count;

            // Create metadata for this chunk
            metadatas.push({
              ...metadata,
              ...sectionInfo,
              chunk_index: index,
              url: url,
              source: sourceId,
              crawl_time: new Date().toISOString()
            });
          });

          // Create URL to full document mapping
          const urlToFullDocument: Record<string, string> = {
            [url]: content
          };

          // Update source information FIRST (before inserting documents)
          // Use first 5000 chars for summary like in Python
          let summary = "";
          try {
            summary = await extractSourceSummary(
              sourceId,
              content.substring(0, 5000),
              openaiClient,
              500,
              modelChoice
            );
          } catch (error) {
            console.log(`Warning: Could not generate summary for ${sourceId}:`, error);
            // Extract first few sentences as fallback summary
            const sentences = content.match(/[^\.!?]+[\.!?]+/g) || [];
            summary = sentences.slice(0, 3).join(' ').trim() || `Source: ${sourceId}`;
          }

          // Get user ID from agent props
          const userId = agent.props?.userId;

          await updateSourceInfo(supabaseClient, sourceId, summary, totalWordCount, userId);

          // Add documents to Supabase AFTER source exists
          await addDocumentsToSupabase(
            supabaseClient,
            urls,
            chunkNumbers,
            contents,
            metadatas,
            urlToFullDocument,
            openaiClient,
            modelEmbedding,
            env.USE_CONTEXTUAL_EMBEDDINGS === "true",
            modelChoice,
            userId
          );

          // Extract and process code examples if USE_AGENTIC_RAG is enabled
          let codeBlocks: ReturnType<typeof extractCodeBlocks> = [];
          const useAgenticRag = env.USE_AGENTIC_RAG === "true";

          if (useAgenticRag && openaiClient) {
            // Extract code blocks from content
            codeBlocks = extractCodeBlocks(content);

            if (codeBlocks && codeBlocks.length > 0) {
              // Prepare data for code examples
              const codeUrls: string[] = [];
              const codeChunkNumbers: number[] = [];
              const codeExamples: string[] = [];
              const codeSummaries: string[] = [];
              const codeMetadatas: Record<string, any>[] = [];

              // Process code examples in parallel
              const summaryPromises = codeBlocks.map(block =>
                processCodeExample(
                  block.code,
                  block.context_before,
                  block.context_after,
                  openaiClient,
                  modelChoice
                )
              );

              // Wait for all summaries to be generated
              const summaries = await Promise.all(
                summaryPromises.map(p => p.catch(e => {
                  console.log(`Error processing code example: ${e}`);
                  return "Code example for demonstration purposes.";
                }))
              );

              // Process each code block
              codeBlocks.forEach((block, index) => {
                codeUrls.push(url);
                codeChunkNumbers.push(index);
                codeExamples.push(block.code);
                codeSummaries.push(summaries[index]);

                // Create metadata for code example
                codeMetadatas.push({
                  chunk_index: index,
                  url: url,
                  source: sourceId,
                  char_count: block.code.length,
                  word_count: block.code.split(/\s+/).length,
                  language: block.language
                });
              });

              // Add code examples to Supabase
              await addCodeExamplesToSupabase(
                supabaseClient,
                codeUrls,
                codeChunkNumbers,
                codeExamples,
                codeSummaries,
                codeMetadatas,
                openaiClient,
                modelEmbedding,
                userId
              );
            }
          }

          // Count internal and external links
          const internalLinks = crawlResult.links.filter(link => link.internal).length;
          const externalLinks = crawlResult.links.filter(link => !link.internal).length;

          // Return success result with format matching Python version
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                url: url,
                chunks_stored: chunks.length,
                code_examples_stored: codeBlocks.length || 0,
                content_length: content.length,
                total_word_count: totalWordCount,
                source_id: sourceId,
                links_count: {
                  internal: internalLinks,
                  external: externalLinks
                }
              }, null, 2)
            }]
          };

        } catch (error) {
          console.error('Error processing content:', error);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Error processing content: ${(error as Error).message}`,
                url: url
              }, null, 2)
            }]
          };
        }
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Unexpected error: ${(error as Error).message}`,
              url: url
            }, null, 2)
          }]
        };
      }
    }
  );
}
