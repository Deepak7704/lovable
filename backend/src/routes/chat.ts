import { Router } from 'express';
import { streamObject } from 'ai';
import gemini from '../lib/ai_config';
import { SandboxManager } from '../lib/sandbox_manager';
import { SandboxExecutor } from '../lib/sandbox_executor';
import { GenerationSchema } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const sandboxManager = new SandboxManager();
const executor = new SandboxExecutor();

router.post('/chat', async (req, res) => {
  try {
    const { messages, projectId: existingProjectId } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const projectId = existingProjectId || uuidv4();
    const userMessage = messages[messages.length - 1]?.content || '';

    console.log(`\n=== New Chat Request ===`);
    console.log(`Project ID: ${projectId}`);
    console.log(`User prompt: ${userMessage.substring(0, 100)}...`);

    // Set headers for SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Project-Id', projectId);

    // Step 1: Get or create sandbox
    console.log('Step 1: Sandbox initialization');
    let sandbox = sandboxManager.get(projectId);
    if (!sandbox) {
      console.log('Creating new sandbox...');
      sandbox = await sandboxManager.create(projectId);
      console.log('✓ Sandbox created');
    } else {
      console.log('✓ Using existing sandbox');
    }

    // Step 2: Get current file tree for context
    console.log('Step 2: Getting file tree');
    const existingFiles = await executor.getFileTree(sandbox);
    console.log(`✓ Found ${existingFiles.length} files`);

    // Step 3: Build AI prompt
    const prompt = buildPrompt(userMessage, existingFiles);

    // Step 4: Stream AI generation with proper response handling
    console.log('Step 3: Starting AI generation');
    
    const result = streamObject({
      model: gemini,
      schema: GenerationSchema,
      prompt: prompt,
      onFinish: async ({ object: generation, error: streamError }) => {
        if (!generation) {
          console.error('✗ AI generation failed - object is undefined');
          if (streamError) {
            console.error('Stream error:', streamError);
          }
          return;
        }

        console.log('✓ AI generation completed');
        console.log(`Generated ${generation.fileOperations.length} file operations`);

        try {
          // Step 5: Execute file operations
          console.log('Step 4: Executing file operations');
          for (let i = 0; i < generation.fileOperations.length; i++) {
            const operation = generation.fileOperations[i];
            console.log(`  [${i + 1}/${generation.fileOperations.length}] ${operation.type}: ${operation.path}`);
            await executor.executeFileOperation(sandbox!, operation);
          }
          console.log('✓ All file operations completed');

          // Step 6: Execute shell commands
          if (generation.shellCommands.length > 0) {
            console.log('Step 5: Executing shell commands');
            for (const command of generation.shellCommands) {
              console.log(`  Running: ${command}`);
              await executor.executeShellCommands(sandbox!, command);
            }
            console.log('✓ All commands completed');
          }

          // Step 7: Start/restart dev server
          console.log('Step 6: Starting dev server');
          try {
            const previewUrl = await executor.startDevServer(sandbox!);
            console.log(`✓ Dev server ready: ${previewUrl}`);
          } catch (error) {
            console.error('✗ Failed to start dev server:', error);
          }

          // Step 8: Get updated file tree
          const updatedFiles = await executor.getFileTree(sandbox!);
          console.log(`✓ Project now has ${updatedFiles.length} files`);

          console.log('=== Request completed successfully ===\n');
        } catch (error) {
          console.error('Error during execution:', error);
        }
      },
    });

    // CRITICAL: Pipe the stream directly to response
    // This ensures the client receives data as it's generated
    const stream = result.textStream;
    
    for await (const chunk of stream) {
      res.write(chunk);
    }
    
    res.end();

  } catch (error) {
    console.error('Request error:', error);
    
    // Only send JSON error if headers haven't been sent
    if (!res.headersSent) {
      return res.status(500).json({
        error: (error as Error).message,
      });
    } else {
      res.end();
    }
  }
});

/**
 * Build comprehensive prompt for AI
 */
function buildPrompt(
  userPrompt: string,
  existingFiles: Array<{ path: string; type: string }>
): string {
  const fileList = existingFiles
    .filter((f) => f.type === 'file')
    .map((f) => f.path)
    .join('\n');

  return `You are an expert React + TypeScript developer using Vite and Tailwind CSS.

CURRENT PROJECT FILES:
${fileList || 'Empty project (only boilerplate)'}

USER REQUEST:
${userPrompt}

INSTRUCTIONS:
1. Generate modern, clean React components using TypeScript
2. Use Tailwind CSS for all styling (no external CSS files unless necessary)
3. Follow React best practices and hooks patterns
4. Use functional components with proper TypeScript types
5. Ensure code is production-ready and well-structured
6. Only create/modify files that are necessary for the user's request
7. If installing new packages, add them to shellCommands

OUTPUT REQUIREMENTS:
- fileOperations: Array of operations (createFile, rewriteFile, updateFile, deleteFile)
- shellCommands: Only include if you need to install new packages (e.g., "npm install react-router-dom")
- explanation: A brief, user-friendly explanation of what you created

IMPORTANT:
- File paths should be relative to project root (e.g., "src/components/Button.tsx")
- Include complete file content, not snippets
- Ensure all imports are correct
- Use proper TypeScript types`;
}

export default router;