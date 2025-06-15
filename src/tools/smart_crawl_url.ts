import { z } from "zod";
import { experimental_PaidMcpAgent as PaidMcpAgent } from "@stripe/agent-toolkit/cloudflare";
import { WebCrawler } from "../utils/crawler";
import { getSupabaseClient } from "../utils/supabase";
import { extractSourceMetadata, updateSourceInfo, extractSourceSummary } from '../utils/metadata';
import { addDocumentsToSupabase, addCodeExamplesToSupabase } from '../utils/documents';
import { smartChunkMarkdown, extractSectionInfo } from '../utils/content_processor';
import { extractCodeBlocks, processCodeExample } from "../utils/code";
import { isSitemap, isTextFile, parseSitemap, crawlTextFile } from "../utils/url";
import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers";
import { Client } from "langsmith";
import { REUSABLE_PAYMENT_REASON } from "../helpers/constants";

export function smartCrawlUrlTool(
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
    STRIPE_SUBSCRIPTION_PRICE_ID?: string;
    BASE_URL?: string;
  }
) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_KEY || !env?.BROWSERLESS_TOKEN || !env?.COHERE_API_KEY) {
    throw new Error("Missing required environment variables");
  }

  const priceId = env?.STRIPE_SUBSCRIPTION_PRICE_ID || null;
  const baseUrl = env?.BASE_URL || null;

  if (!priceId || !baseUrl) {
    throw new Error("STRIPE_SUBSCRIPTION_PRICE_ID and BASE_URL are required for paid tools");
  }

  agent.paidTool(
    "smart_crawl_url",
    `Intelligently crawl a URL based on its type and store content in Supabase.

This tool automatically detects the URL type and applies the appropriate crawling method:
- For sitemaps: Extracts and crawls all URLs in parallel
- For text files (llms.txt): Directly retrieves the content
- For regular webpages: Recursively crawls internal links up to the specified depth

All crawled content is chunked and stored in Supabase for later retrieval and querying.`,
    {
      url: z.string().url().describe("URL to crawl (can be a regular webpage, sitemap.xml, or .txt file)"),
      max_depth: z.number().min(1).max(5).optional().default(3).describe("Maximum recursion depth for regular URLs (default: 3)"),
      max_concurrent: z.number().min(1).max(10).optional().default(2).describe("Maximum number of concurrent browser sessions (default: 10)"),
      chunk_size: z.number().min(500).max(10000).optional().default(5000).describe("Maximum size of each content chunk in characters (default: 5000)")
    },
    async ({ url, max_depth = 3, max_concurrent = 10, chunk_size = 5000 }: {
      url: string;
      max_depth?: number;
      max_concurrent?: number;
      chunk_size?: number;
    }) => {
      try {
        // Initialize the web crawler with Browserless
        const crawler = new WebCrawler({
          browserlessToken: env.BROWSERLESS_TOKEN,
          browserlessUrl: env.BROWSERLESS_URL,
          timeout: 30000
        });

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
          name: "smart_crawl_url",
          run_type: "llm",
          client: langsmithClient,
          tracingEnabled: true,
          project_name: env.LANGSMITH_PROJECT || "Testing"
        });

        // Get model choices
        const modelChoice = env.MODEL_CHOICE || "gpt-3.5-turbo";
        const modelEmbedding = env.MODEL_EMBEDDING || "text-embedding-3-small";

        // Determine the crawl strategy
        let crawlResults: Array<{url: string, markdown: string}> = [];
        let crawlType = "";

        if (isTextFile(url)) {
          // For text files, use simple crawl
          crawlResults = await crawlTextFile(url);
          crawlType = "text_file";
        } else if (isSitemap(url)) {
          // For sitemaps, extract URLs and crawl in parallel
          const sitemapUrls = await parseSitemap(url);
          if (!sitemapUrls || sitemapUrls.length === 0) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: false,
                  url: url,
                  error: "No URLs found in sitemap"
                }, null, 2)
              }]
            };
          }
          crawlResults = await crawler.crawlBatch(sitemapUrls, max_concurrent);
          crawlType = "sitemap";
        } else {
          // For regular URLs, use recursive crawl
          crawlResults = await crawler.crawlRecursiveInternalLinks([url], max_depth, max_concurrent);
          crawlType = "webpage";
        }

        if (!crawlResults || crawlResults.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                url: url,
                error: "No content found"
              }, null, 2)
            }]
          };
        }

        // Process results and store in Supabase
        const urls: string[] = [];
        const chunkNumbers: number[] = [];
        const contents: string[] = [];
        const metadatas: Record<string, any>[] = [];
        let chunkCount = 0;

        // Track sources and their content
        const sourceContentMap: Record<string, string> = {};
        const sourceWordCounts: Record<string, number> = {};

        // Process documentation chunks
        for (const doc of crawlResults) {
          const sourceUrl = doc.url;
          const md = doc.markdown;
          const chunks = smartChunkMarkdown(md, chunk_size);

          // Extract source_id
          const parsedUrl = new URL(sourceUrl);
          const sourceId = (parsedUrl.hostname || parsedUrl.pathname).replace(/^www\./, '');

          // Store content for source summary generation
          if (!sourceContentMap[sourceId]) {
            sourceContentMap[sourceId] = md.substring(0, 5000); // Store first 5000 chars
            sourceWordCounts[sourceId] = 0;
          }

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            urls.push(sourceUrl);
            chunkNumbers.push(i);
            contents.push(chunk);

            // Extract metadata
            const meta = extractSectionInfo(chunk);
            const metadata = {
              ...meta,
              chunk_index: i,
              url: sourceUrl,
              source: sourceId,
              crawl_type: crawlType,
              crawl_time: new Date().toISOString()
            };
            metadatas.push(metadata);

            // Accumulate word count
            sourceWordCounts[sourceId] += meta.word_count || 0;
            chunkCount++;
          }
        }

        // Create url_to_full_document mapping
        const urlToFullDocument: Record<string, string> = {};
        for (const doc of crawlResults) {
          urlToFullDocument[doc.url] = doc.markdown;
        }

        // Update source information for each unique source FIRST (before inserting documents)
        const sourceIds = Object.keys(sourceContentMap);
        
        // Get user ID from agent props
        const userId = agent.props?.userId;
        
        for (const sourceId of sourceIds) {
          const content = sourceContentMap[sourceId];
          let summary = "";
          
          try {
            summary = await extractSourceSummary(
              sourceId,
              content,
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

          const wordCount = sourceWordCounts[sourceId] || 0;
          await updateSourceInfo(supabaseClient, sourceId, summary, wordCount, userId);
        }

        // Add documentation chunks to Supabase (AFTER sources exist)
        const batchSize = 20;
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
          userId,
          batchSize
        );

        // Extract and process code examples from all documents only if enabled
        const extractCodeExamplesEnabled = env.USE_AGENTIC_RAG === "true";
        let allCodeBlocks: ReturnType<typeof extractCodeBlocks> = [];
        
        if (extractCodeExamplesEnabled && openaiClient) {
          const codeUrls: string[] = [];
          const codeChunkNumbers: number[] = [];
          const codeExamples: string[] = [];
          const codeSummaries: string[] = [];
          const codeMetadatas: Record<string, any>[] = [];

          // Extract code blocks from all documents
          for (const doc of crawlResults) {
            const sourceUrl = doc.url;
            const md = doc.markdown;
            const codeBlocks = extractCodeBlocks(md);
            if (codeBlocks && codeBlocks.length > 0) {
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

              // Generate summaries in parallel
              const summaries = await Promise.all(
                summaryPromises.map(p => p.catch(e => {
                  console.log(`Error processing code example: ${e}`);
                  return "Code example for demonstration purposes.";
                }))
              );

              // Prepare code example data
              const parsedUrl = new URL(sourceUrl);
              const sourceId = (parsedUrl.hostname || parsedUrl.pathname).replace(/^www\./, '');

              for (let i = 0; i < codeBlocks.length; i++) {
                const block = codeBlocks[i];
                const summary = summaries[i];
                
                codeUrls.push(sourceUrl);
                codeChunkNumbers.push(codeExamples.length); // Use global code example index
                codeExamples.push(block.code);
                codeSummaries.push(summary);

                // Create metadata for code example
                const codeMeta = {
                  chunk_index: codeExamples.length - 1,
                  url: sourceUrl,
                  source: sourceId,
                  char_count: block.code.length,
                  word_count: block.code.split(/\s+/).length,
                  language: block.language
                };
                codeMetadatas.push(codeMeta);
              }

              allCodeBlocks.push(...codeBlocks);
            }
          }

          // Add all code examples to Supabase
          if (codeExamples.length > 0) {
            await addCodeExamplesToSupabase(
              supabaseClient,
              codeUrls,
              codeChunkNumbers,
              codeExamples,
              codeSummaries,
              codeMetadatas,
              openaiClient,
              modelEmbedding,
              userId,
              batchSize
            );
          }
        }

        // Return success result matching Python format
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              url: url,
              crawl_type: crawlType,
              pages_crawled: crawlResults.length,
              chunks_stored: chunkCount,
              code_examples_stored: allCodeBlocks.length,
              sources_updated: Object.keys(sourceContentMap).length,
              urls_crawled: crawlResults.slice(0, 5).map(doc => doc.url).concat(
                crawlResults.length > 5 ? ["..."] : []
              )
            }, null, 2)
          }]
        };

      } catch (error) {
        console.error('Error in smart crawl:', error);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              url: url,
              error: (error as Error).message
            }, null, 2)
          }]
        };
      }
    },
    {
      checkout: {
        success_url: `${baseUrl}/payment/success`,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
      },
      paymentReason: REUSABLE_PAYMENT_REASON,
    }
  );
}
