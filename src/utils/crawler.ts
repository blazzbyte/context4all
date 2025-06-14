import { parse, HTMLElement } from 'node-html-parser';

/**
 * Interface for crawler options
 */
interface WebCrawlerOptions {
  browserlessToken: string;
  browserlessUrl?: string;
  timeout?: number;
}

/**
 * Interface for link information
 */
interface LinkInfo {
  url: string;
  text: string;
  internal: boolean;
}

/**
 * Interface for crawl result
 */
interface CrawlResult {
  url: string;
  html: string;
  markdown: string;
  links: LinkInfo[];
  success: boolean;
  error?: string;
}

/**
 * Web crawler class using Browserless for TypeScript
 */
export class WebCrawler {
  private browserlessToken: string;
  private browserlessUrl: string;
  private timeout: number;

  constructor(options: WebCrawlerOptions) {
    if (!options.browserlessToken) {
      throw new Error('browserlessToken is required');
    }
    this.browserlessToken = options.browserlessToken;
    this.browserlessUrl = options.browserlessUrl || 'https://production-sfo.browserless.io';
    this.timeout = options.timeout || 30000;
  }

  /**
   * Crawl a URL and extract content using Browserless
   * 
   * @param url URL to crawl
   * @returns Crawl result object
   */
  async crawl(url: string): Promise<CrawlResult> {
    try {
      // Prepare the request payload for Browserless
      const payload = {
        url: url,
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: this.timeout
        }
      };

      // Make request to Browserless API
      const browserlessEndpoint = `${this.browserlessUrl}/content?token=${this.browserlessToken}`;
      
      const response = await fetch(browserlessEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Browserless API error: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      
      if (!html || html.trim().length === 0) {
        throw new Error('No HTML content received from Browserless');
      }

      // Extract text content and convert to markdown
      const markdown = this.htmlToMarkdown(html);
      
      // Extract links
      const links = this.extractLinksFromHtml(html, url);

      return {
        url,
        html,
        markdown,
        links,
        success: true
      };
    } catch (error) {
      return {
        url,
        html: '',
        markdown: '',
        links: [],
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Crawl a URL and get screenshot using Browserless
   * 
   * @param url URL to crawl
   * @param options Screenshot options
   * @returns Screenshot as base64 string
   */
  async screenshot(url: string, options: {
    fullPage?: boolean;
    width?: number;
    height?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
  } = {}): Promise<string> {
    try {
      const payload = {
        url: url,
        options: {
          fullPage: options.fullPage || false,
          type: options.format || 'png',
          quality: options.quality || 80,
          viewport: {
            width: options.width || 1280,
            height: options.height || 720
          }
        },
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: this.timeout
        }
      };

      const browserlessEndpoint = `${this.browserlessUrl}/screenshot?token=${this.browserlessToken}`;
      
      const response = await fetch(browserlessEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Browserless screenshot API error: ${response.status} ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      
      return base64;
    } catch (error) {
      throw new Error(`Screenshot failed: ${(error as Error).message}`);
    }
  }

  /**
   * Execute custom JavaScript on a page using Browserless
   * 
   * @param url URL to navigate to
   * @param script JavaScript code to execute
   * @returns Result of script execution
   */
  async executeScript(url: string, script: string): Promise<any> {
    try {
      const payload = {
        url: url,
        code: script,
        context: {},
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: this.timeout
        }
      };

      const browserlessEndpoint = `${this.browserlessUrl}/function?token=${this.browserlessToken}`;
      
      const response = await fetch(browserlessEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Browserless function API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`Script execution failed: ${(error as Error).message}`);
    }
  }

  /**
   * Extract links from HTML content
   * 
   * @param html HTML content
   * @param baseUrl Base URL for resolving relative links
   * @returns Array of link information
   */
  private extractLinksFromHtml(html: string, baseUrl: string): LinkInfo[] {
    const root = parse(html);
    const links: LinkInfo[] = [];
    const urlObj = new URL(baseUrl);
    const origin = `${urlObj.protocol}//${urlObj.host}`;
    
    const anchorElements = root.querySelectorAll('a[href]');
    
    anchorElements.forEach(anchor => {
      const href = anchor.getAttribute('href');
      if (href) {
        let fullUrl: string;
        
        // Handle relative URLs
        if (href.startsWith('http://') || href.startsWith('https://')) {
          fullUrl = href;
        } else if (href.startsWith('/')) {
          fullUrl = `${origin}${href}`;
        } else {
          fullUrl = `${baseUrl.replace(/\/$/, '')}/${href.replace(/^\//, '')}`;
        }
        
        links.push({
          url: fullUrl,
          text: anchor.text.trim(),
          internal: fullUrl.startsWith(origin)
        });
      }
    });
    
    return links;
  }

  /**
   * Convert HTML to Markdown
   * 
   * @param html HTML content
   * @returns Markdown content
   */
  private htmlToMarkdown(html: string): string {
    const root = parse(html);
    
    // Remove script and style elements
    root.querySelectorAll('script, style, nav, footer, header').forEach(el => el.remove());
    
    let markdown = '';
    
    // Process the main content
    const mainContent = root.querySelector('main') || root.querySelector('article') || root.querySelector('body') || root;
    
    markdown = this.processElement(mainContent);
    
    // Clean up the markdown
    markdown = markdown
      .replace(/\n{3,}/g, '\n\n') // Replace multiple newlines with double newlines
      .replace(/^\s+|\s+$/g, '') // Trim whitespace
      .replace(/\[([^\]]*)\]\(\)/g, '$1'); // Remove empty links
    
    return markdown;
  }

  /**
   * Process an HTML element and its children to Markdown
   * 
   * @param element HTML element
   * @returns Markdown content
   */
  private processElement(element: HTMLElement): string {
    let result = '';
    
    for (const child of element.childNodes) {
      if (child.nodeType === 3) { // Text node
        const text = child.text.trim();
        if (text) {
          result += text + ' ';
        }
      } else if (child.nodeType === 1) { // Element node
        const tagName = (child as HTMLElement).tagName.toLowerCase();
        
        switch (tagName) {
          case 'h1':
            result += '\n# ' + (child as HTMLElement).text.trim() + '\n\n';
            break;
          case 'h2':
            result += '\n## ' + (child as HTMLElement).text.trim() + '\n\n';
            break;
          case 'h3':
            result += '\n### ' + (child as HTMLElement).text.trim() + '\n\n';
            break;
          case 'h4':
            result += '\n#### ' + (child as HTMLElement).text.trim() + '\n\n';
            break;
          case 'h5':
            result += '\n##### ' + (child as HTMLElement).text.trim() + '\n\n';
            break;
          case 'h6':
            result += '\n###### ' + (child as HTMLElement).text.trim() + '\n\n';
            break;
          case 'p':
            result += '\n' + this.processElement(child as HTMLElement).trim() + '\n\n';
            break;
          case 'br':
            result += '\n';
            break;
          case 'strong':
          case 'b':
            result += '**' + (child as HTMLElement).text.trim() + '**';
            break;
          case 'em':
          case 'i':
            result += '*' + (child as HTMLElement).text.trim() + '*';
            break;
          case 'code':
            result += '`' + (child as HTMLElement).text.trim() + '`';
            break;
          case 'pre':
            const codeContent = (child as HTMLElement).querySelector('code');
            if (codeContent) {
              result += '\n```\n' + codeContent.text.trim() + '\n```\n\n';
            } else {
              result += '\n```\n' + (child as HTMLElement).text.trim() + '\n```\n\n';
            }
            break;
          case 'blockquote':
            const lines = (child as HTMLElement).text.trim().split('\n');
            result += '\n' + lines.map(line => '> ' + line.trim()).join('\n') + '\n\n';
            break;
          case 'ul':
          case 'ol':
            result += '\n' + this.processList(child as HTMLElement, tagName === 'ol') + '\n';
            break;
          case 'li':
            // This will be handled by processList
            break;
          case 'a':
            const href = (child as HTMLElement).getAttribute('href');
            const text = (child as HTMLElement).text.trim();
            if (href && text) {
              result += `[${text}](${href})`;
            } else {
              result += text;
            }
            break;
          case 'img':
            const src = (child as HTMLElement).getAttribute('src');
            const alt = (child as HTMLElement).getAttribute('alt') || '';
            if (src) {
              result += `![${alt}](${src})`;
            }
            break;
          case 'table':
            result += '\n' + this.processTable(child as HTMLElement) + '\n';
            break;
          case 'div':
          case 'span':
          case 'section':
          case 'article':
            result += this.processElement(child as HTMLElement);
            break;
          default:
            // For other elements, just process their children
            result += this.processElement(child as HTMLElement);
            break;
        }
      }
    }
    
    return result;
  }

  /**
   * Process a list element to Markdown
   * 
   * @param listElement List element
   * @param isOrdered Whether the list is ordered
   * @returns Markdown list
   */
  private processList(listElement: HTMLElement, isOrdered = false): string {
    let result = '';
    const items = listElement.querySelectorAll('li');
    
    items.forEach((item, index) => {
      const prefix = isOrdered ? `${index + 1}. ` : '- ';
      const content = this.processElement(item).trim();
      result += prefix + content + '\n';
    });
    
    return result;
  }

  /**
   * Process a table element to Markdown
   * 
   * @param tableElement Table element
   * @returns Markdown table
   */
  private processTable(tableElement: HTMLElement): string {
    let result = '';
    const rows = tableElement.querySelectorAll('tr');
    
    if (rows.length === 0) return result;
    
    // Process header row
    const headerRow = rows[0];
    const headerCells = headerRow.querySelectorAll('th, td');
    const headers = Array.from(headerCells).map(cell => cell.text.trim());
    
    if (headers.length > 0) {
      result += '| ' + headers.join(' | ') + ' |\n';
      result += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
    }
    
    // Process data rows
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const cells = row.querySelectorAll('td, th');
      const cellData = Array.from(cells).map(cell => cell.text.trim());
      
      if (cellData.length > 0) {
        result += '| ' + cellData.join(' | ') + ' |\n';
      }
    }
    
    return result;
  }

  /**
   * Crawl a markdown or text file
   * 
   * @param url URL of the file to crawl
   * @returns Array with URL and markdown content
   */
  async crawlMarkdownFile(url: string): Promise<Array<{url: string, markdown: string}>> {
    try {
      const result = await this.crawl(url);
      
      if (result.success && result.markdown) {
        return [{ url: url, markdown: result.markdown }];
      } else {
        console.log(`Failed to crawl ${url}: ${result.error}`);
        return [];
      }
    } catch (error) {
      console.log(`Error crawling markdown file ${url}: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Batch crawl multiple URLs in parallel
   * 
   * @param urls List of URLs to crawl
   * @param maxConcurrent Maximum number of concurrent requests
   * @returns Array of objects with URL and markdown content
   */
  async crawlBatch(urls: string[], maxConcurrent: number = 10): Promise<Array<{url: string, markdown: string}>> {
    const results: Array<{url: string, markdown: string}> = [];
    
    // Process URLs in batches to control concurrency
    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const batch = urls.slice(i, i + maxConcurrent);
      
      // Create promises for the current batch
      const batchPromises = batch.map(async (url) => {
        try {
          const result = await this.crawl(url);
          if (result.success && result.markdown) {
            return { url: result.url, markdown: result.markdown };
          }
          return null;
        } catch (error) {
          console.log(`Error crawling ${url}: ${(error as Error).message}`);
          return null;
        }
      });
      
      // Wait for all promises in the current batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Add successful results to the main results array
      batchResults.forEach(result => {
        if (result) {
          results.push(result);
        }
      });
      
      // Add a small delay between batches to avoid overwhelming the server
      if (i + maxConcurrent < urls.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }

  /**
   * Normalize URL by removing fragment
   * 
   * @param url URL to normalize
   * @returns Normalized URL
   */
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove fragment (hash)
      urlObj.hash = '';
      return urlObj.toString();
    } catch (error) {
      return url;
    }
  }

  /**
   * Recursively crawl internal links from start URLs up to a maximum depth
   * 
   * @param startUrls List of starting URLs
   * @param maxDepth Maximum recursion depth
   * @param maxConcurrent Maximum number of concurrent requests
   * @returns Array of objects with URL and markdown content
   */
  async crawlRecursiveInternalLinks(
    startUrls: string[], 
    maxDepth: number = 3, 
    maxConcurrent: number = 10
  ): Promise<Array<{url: string, markdown: string}>> {
    const visited = new Set<string>();
    const resultsAll: Array<{url: string, markdown: string}> = [];
    
    // Normalize starting URLs
    let currentUrls = new Set(startUrls.map(url => this.normalizeUrl(url)));
    
    for (let depth = 0; depth < maxDepth; depth++) {
      // Filter out already visited URLs
      const urlsToCrawl = Array.from(currentUrls).filter(url => !visited.has(this.normalizeUrl(url)));
      
      if (urlsToCrawl.length === 0) {
        break;
      }
      
      console.log(`Crawling depth ${depth + 1}/${maxDepth}: ${urlsToCrawl.length} URLs`);
      
      // Crawl current level URLs in batches
      const results = await this.crawlBatch(urlsToCrawl, maxConcurrent);
      const nextLevelUrls = new Set<string>();
      
      for (const result of results) {
        const normUrl = this.normalizeUrl(result.url);
        visited.add(normUrl);
        
        if (result.markdown) {
          resultsAll.push({ url: result.url, markdown: result.markdown });
          
          // Extract internal links for next level
          try {
            const crawlResult = await this.crawl(result.url);
            if (crawlResult.success) {
              crawlResult.links
                .filter(link => link.internal)
                .forEach(link => {
                  const nextUrl = this.normalizeUrl(link.url);
                  if (!visited.has(nextUrl)) {
                    nextLevelUrls.add(nextUrl);
                  }
                });
            }
          } catch (error) {
            console.log(`Error extracting links from ${result.url}: ${(error as Error).message}`);
          }
        }
      }
      
      currentUrls = nextLevelUrls;
      
      // Add delay between depth levels
      if (depth < maxDepth - 1 && currentUrls.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log(`Recursive crawl completed. Total pages crawled: ${resultsAll.length}`);
    return resultsAll;
  }
}
