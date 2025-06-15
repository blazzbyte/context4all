/**
 * Utilities for handling code examples and blocks
 */
import OpenAI from 'openai';

/**
 * Process a single code example to generate its summary.
 * This function is designed to be used with Promise.all for parallel processing.
 * 
 * @param code The code example
 * @param contextBefore Context before the code
 * @param contextAfter Context after the code
 * @param openaiClient OpenAI client instance
 * @param modelChoice Model to use
 * @returns The generated summary
 */
export async function processCodeExample(
  code: string,
  contextBefore: string,
  contextAfter: string,
  openaiClient: OpenAI,
  modelChoice?: string
): Promise<string> {
  return generateCodeExampleSummary(code, contextBefore, contextAfter, openaiClient, modelChoice);
}

/**
 * Extract code blocks from markdown content along with context
 * 
 * @param markdownContent The markdown content to extract code blocks from
 * @param minLength Minimum length of code blocks to extract (default: 1000 characters)
 * @returns List of objects containing code blocks and their context
 */
export function extractCodeBlocks(
  markdownContent: string,
  minLength: number = 1000
): Array<{
  code: string;
  language: string;
  context_before: string;
  context_after: string;
  full_context: string;
}> {
  const codeBlocks = [];

  // Skip if content starts with triple backticks (edge case for files wrapped in backticks)
  const content = markdownContent.trim();
  let startOffset = 0;
  if (content.startsWith('```')) {
    // Skip the first triple backticks
    startOffset = 3;
    console.log("Skipping initial triple backticks");
  }

  // Find all occurrences of triple backticks
  const backtickPositions: number[] = [];
  let pos = startOffset;
  while (true) {
    pos = markdownContent.indexOf('```', pos);
    if (pos === -1) {
      break;
    }
    backtickPositions.push(pos);
    pos += 3;
  }

  // Process pairs of backticks
  let i = 0;
  while (i < backtickPositions.length - 1) {
    const startPos = backtickPositions[i];
    const endPos = backtickPositions[i + 1];

    // Extract the content between backticks
    const codeSection = markdownContent.substring(startPos + 3, endPos);

    // Check if there's a language specifier on the first line
    const lines = codeSection.split('\n');
    let language = "";
    let codeContent = "";

    if (lines.length > 1) {
      // Check if first line is a language specifier (no spaces, common language names)
      const firstLine = lines[0].trim();
      if (firstLine && !firstLine.includes(' ') && firstLine.length < 20) {
        language = firstLine;
        // Get all content after the first line (language specifier)
        codeContent = lines.slice(1).join('\n').trim();
      } else {
        language = "";
        codeContent = codeSection.trim();
      }
    } else {
      language = "";
      codeContent = codeSection.trim();
    }

    // Skip if code block is too short
    if (codeContent.length < minLength) {
      i += 2;  // Move to next pair
      continue;
    }

    // Extract context before (1000 chars)
    const contextStart = Math.max(0, startPos - 1000);
    const contextBefore = markdownContent.substring(contextStart, startPos).trim();

    // Extract context after (1000 chars)
    const contextEnd = Math.min(markdownContent.length, endPos + 3 + 1000);
    const contextAfter = markdownContent.substring(endPos + 3, contextEnd).trim();

    codeBlocks.push({
      code: codeContent,
      language: language,
      context_before: contextBefore,
      context_after: contextAfter,
      full_context: `${contextBefore}\n\n${codeContent}\n\n${contextAfter}`
    });

    // Move to next pair (skip the closing backtick we just processed)
    i += 2;
  }

  return codeBlocks;
}

/**
 * Generate a summary for a code example using its surrounding context
 * 
 * @param code The code example
 * @param contextBefore Context before the code
 * @param contextAfter Context after the code
 * @param openaiClient OpenAI client instance
 * @param modelChoice Model to use
 * @returns A summary of what the code example demonstrates
 */
export async function generateCodeExampleSummary(
  code: string,
  contextBefore: string,
  contextAfter: string,
  openaiClient: OpenAI,
  modelChoice?: string
): Promise<string> {
  if (!openaiClient) {
    return "Code example for demonstration purposes.";
  }

  // Create the prompt
  const prompt = `<context_before>
${contextBefore.length > 500 ? contextBefore.slice(-500) : contextBefore}
</context_before>

<code_example>
${code.length > 1500 ? code.substring(0, 1500) : code}
</code_example>

<context_after>
${contextAfter.length > 500 ? contextAfter.substring(0, 500) : contextAfter}
</context_after>

Based on the code example and its surrounding context, provide a concise summary (2-3 sentences) that describes what this code example demonstrates and its purpose. Focus on the practical application and key concepts illustrated.
`;

  try {
    const response = await openaiClient.chat.completions.create({
      model: modelChoice || "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant that provides concise code example summaries." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 100
    });

    return response.choices[0].message.content?.trim() || "Code example for demonstration purposes.";
  } catch (e) {
    console.log(`Error generating code example summary: ${e}`);
    return "Code example for demonstration purposes.";
  }
}
