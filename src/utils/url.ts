/**
 * Check if a URL is a sitemap
 * 
 * @param url URL to check
 * @returns Boolean indicating if the URL is a sitemap
 */
export function isSitemap(url: string): boolean {
  return url.includes('sitemap') && (url.endsWith('.xml') || url.includes('sitemap.xml'));
}

/**
 * Check if a URL is a text file
 * 
 * @param url URL to check
 * @returns Boolean indicating if the URL is a text file
 */
export function isTextFile(url: string): boolean {
  return url.endsWith('.txt');
}

/**
 * Parse a sitemap XML to extract URLs
 * 
 * @param url URL of the sitemap to parse
 * @returns Array of URLs found in the sitemap
 */
export async function parseSitemap(url: string): Promise<string[]> {
  try {
    const response = await fetch(url);
    const xml = await response.text();
    
    // Simple XML parsing for sitemap URLs
    const urlMatches = xml.match(/<loc>(.*?)<\/loc>/g);
    if (!urlMatches) return [];
    
    return urlMatches.map(match => 
      match.replace('<loc>', '').replace('</loc>', '').trim()
    );
  } catch (error) {
    console.error('Error parsing sitemap:', error);
    return [];
  }
}

/**
 * Crawl a text file and return its contents
 * 
 * @param url URL of the text file to crawl
 * @returns Array containing a single result with the crawled content
 */
export async function crawlTextFile(url: string): Promise<Array<{
  url: string;
  markdown: string;
  success: boolean;
  error?: string;
}>> {
  try {
    const response = await fetch(url);
    const text = await response.text();
    
    return [{
      url,
      markdown: text,
      success: true
    }];
  } catch (error) {
    console.error('Error crawling text file:', error);
    return [{
      url,
      markdown: '',
      success: false,
      error: (error as Error).message
    }];
  }
}
