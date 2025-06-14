/**
 * Smart chunk markdown content into smaller pieces
 * 
 * @param markdown The markdown content to chunk
 * @param maxChunkSize Maximum size of each chunk
 * @returns Array of markdown chunks
 */
export function smartChunkMarkdown(markdown: string, maxChunkSize: number = 1000): string[] {
  const chunks: string[] = [];
  const lines = markdown.split('\n');
  let currentChunk = '';
  let currentSize = 0;
  
  for (const line of lines) {
    const lineSize = line.length + 1; // +1 for newline
    
    // If adding this line would exceed the chunk size and we have content
    if (currentSize + lineSize > maxChunkSize && currentChunk.trim()) {
      chunks.push(currentChunk.trim());
      currentChunk = line + '\n';
      currentSize = lineSize;
    } else {
      currentChunk += line + '\n';
      currentSize += lineSize;
    }
  }
  
  // Add the last chunk if it has content
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

/**
 * Extract section information from a chunk of text
 * 
 * @param chunk The chunk to extract information from
 * @returns Object containing section information
 */
export function extractSectionInfo(chunk: string): {
  word_count: number;
  char_count: number;
  heading: string;
  line_count: number;
} {
  const lines = chunk.split('\n');
  const wordCount = chunk.split(/\s+/).filter(word => word.length > 0).length;
  const charCount = chunk.length;
  
  // Try to find a heading in the chunk
  let heading = '';
  for (const line of lines) {
    if (line.match(/^#{1,6}\s+/)) {
      heading = line.replace(/^#{1,6}\s+/, '').trim();
      break;
    }
  }
  
  return {
    word_count: wordCount,
    char_count: charCount,
    heading: heading || 'No heading',
    line_count: lines.length
  };
}