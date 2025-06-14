/**
 * Utilities for handling metadata information
 */
import { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

/**
 * Extract source metadata from crawl result
 * 
 * @param source Source information
 * @returns Metadata object
 */
export function extractSourceMetadata(source: {
  url: string;
  title?: string;
  description?: string;
  author?: string;
  publishedTime?: string;
  modifiedTime?: string;
  keywords?: string;
}): Record<string, any> {
  const metadata: Record<string, any> = {
    source_url: source.url,
    title: source.title || '',
    description: source.description || '',
    author: source.author || '',
    published_time: source.publishedTime || '',
    modified_time: source.modifiedTime || '',
    keywords: source.keywords || '',
    extracted_at: new Date().toISOString()
  };

  // Extract domain from URL
  try {
    const urlObj = new URL(source.url);
    metadata.domain = urlObj.hostname.replace(/^www\./, '');
    metadata.protocol = urlObj.protocol;
    metadata.pathname = urlObj.pathname;
  } catch (error) {
    metadata.domain = 'unknown';
    metadata.protocol = 'unknown';
    metadata.pathname = 'unknown';
  }

  return metadata;
}

/**
 * Update or insert source information in the sources table
 * 
 * @param client Supabase client
 * @param sourceId The source ID (domain)
 * @param summary Summary of the source
 * @param wordCount Total word count for the source
 */
export async function updateSourceInfo(
  client: SupabaseClient,
  sourceId: string,
  summary: string,
  wordCount: number
): Promise<void> {
  try {
    // Try to update existing source
    const result = await client
      .from('sources')
      .update({
        summary: summary,
        total_word_count: wordCount,
        updated_at: new Date().toISOString()
      })
      .eq('source_id', sourceId);
    
    // If no rows were affected, insert new source
    const rowsAffected = result.count || 0;
    
    if (rowsAffected === 0) {
      await client
        .from('sources')
        .insert({
          source_id: sourceId,
          summary: summary,
          total_word_count: wordCount
        });
      console.log(`Created new source: ${sourceId}`);
    } else {
      console.log(`Updated source: ${sourceId}`);
    }
  } catch (e) {
    console.log(`Error updating source ${sourceId}: ${e}`);
  }
}

/**
 * Extract a summary for a source from its content using an LLM
 * 
 * This function uses the OpenAI API to generate a concise summary of the source content
 * 
 * @param sourceId The source ID (domain)
 * @param content The content to extract a summary from
 * @param openaiClient OpenAI client instance
 * @param maxLength Maximum length of the summary
 * @param modelChoice Model to use (optional)
 * @returns A summary string
 */
export async function extractSourceSummary(
  sourceId: string,
  content: string,
  openaiClient: OpenAI,
  maxLength: number = 500,
  modelChoice?: string
): Promise<string> {
  // Default summary if we can't extract anything meaningful
  const defaultSummary = `Content from ${sourceId}`;
  
  if (!content || content.trim().length === 0) {
    return defaultSummary;
  }

  if (!openaiClient) {
    console.log(`No OpenAI client provided for ${sourceId}. Using default summary.`);
    return defaultSummary;
  }
  
  // Limit content length to avoid token limits
  const truncatedContent = content.length > 25000 ? content.substring(0, 25000) : content;
  
  // Create the prompt for generating the summary
  const prompt = `<source_content>
${truncatedContent}
</source_content>

The above content is from the documentation for '${sourceId}'. Please provide a concise summary (3-5 sentences) that describes what this library/tool/framework is about. The summary should help understand what the library/tool/framework accomplishes and the purpose.
`;
  
  try {
    // Call the OpenAI API to generate the summary
    const response = await openaiClient.chat.completions.create({
      model: modelChoice || "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant that provides concise library/tool/framework summaries." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 150
    });
    
    // Extract the generated summary
    const summary = response.choices[0].message.content?.trim() || defaultSummary;
    
    // Ensure the summary is not too long
    if (summary.length > maxLength) {
      return summary.substring(0, maxLength) + "...";
    }
    
    return summary;
  } catch (e) {
    console.log(`Error generating summary with LLM for ${sourceId}: ${e}. Using default summary.`);
    return defaultSummary;
  }
}
