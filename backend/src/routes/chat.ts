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

        // CRITICAL FIX: Detect and auto-add missing packages
        const missingPackages = detectMissingPackages(generation);
        if (missingPackages.length > 0) {
          console.warn('⚠ Warning: Detected imported packages not in shellCommands:', missingPackages);
          // Auto-add missing packages to shellCommands
          const installCommand = `npm install ${missingPackages.join(' ')}`;
          if (!generation.shellCommands) {
            generation.shellCommands = [];
          }
          generation.shellCommands.push(installCommand);
          console.log(`✓ Auto-added: ${installCommand}`);
        }

        try {
          // Step 5: Execute file operations
          console.log('Step 4: Executing file operations');
          for (let i = 0; i < generation.fileOperations.length; i++) {
            const operation = generation.fileOperations[i];
            console.log(`  [${i + 1}/${generation.fileOperations.length}] ${operation.type}: ${operation.path}`);
            await executor.executeFileOperation(sandbox!, operation);
          }
          console.log('✓ All file operations completed');

          // Step 6: Execute shell commands (including auto-detected packages)
          if (generation.shellCommands && generation.shellCommands.length > 0) {
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
 * Detect packages imported in code but not included in shellCommands
 */
function detectMissingPackages(generation: any): string[] {
  const standardPackages = new Set([
    'react', 
    'react-dom', 
    'vite', 
    'tailwindcss', 
    'typescript', 
    '@vitejs/plugin-react', 
    '@types/react', 
    '@types/react-dom'
  ]);
  
  const externalPackages = new Set<string>();
  
  // Check all file operations for imports
  for (const op of generation.fileOperations) {
    if (op.content) {
      // Match: import ... from "package" or import ... from 'package'
      const importMatches = op.content.match(/import\s+.*?from\s+['"]([^'"]+)['"]/g);
      if (importMatches) {
        for (const match of importMatches) {
          const packageMatch = match.match(/from\s+['"]([^'"]+)['"]/);
          if (packageMatch) {
            const packageName = packageMatch[1];
            // Only external packages (not relative imports like './Component')
            if (!packageName.startsWith('.') && !packageName.startsWith('/')) {
              // Extract base package name (handle @scoped packages)
              const basePkg = packageName.startsWith('@') 
                ? packageName.split('/').slice(0, 2).join('/')
                : packageName.split('/')[0];
              
              if (!standardPackages.has(basePkg)) {
                externalPackages.add(basePkg);
                
                // Add @types package if needed and not already a types package
                if (!basePkg.startsWith('@types/')) {
                  externalPackages.add(`@types/${basePkg}`);
                }
              }
            }
          }
        }
      }
    }
  }
  
  // Check what's already in shellCommands
  const existingPackages = new Set<string>();
  for (const cmd of generation.shellCommands || []) {
    const packages = cmd.match(/npm\s+(?:install|i)\s+(.+)/);
    if (packages) {
      packages[1].split(/\s+/).forEach((pkg: string) => {
        if (!pkg.startsWith('-')) {
          existingPackages.add(pkg);
        }
      });
    }
  }
  
  // Return packages that are imported but not in shellCommands
  return Array.from(externalPackages).filter(pkg => !existingPackages.has(pkg));
}

/**
 * Build comprehensive prompt for AI with strong package installation instructions
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

CRITICAL PACKAGE INSTALLATION RULES:
- Standard packages already available: react, react-dom, vite, tailwindcss, typescript, @vitejs/plugin-react
- If you import ANY other package (uuid, axios, react-router-dom, date-fns, etc.), you MUST add it to shellCommands
- Format: "npm install package-name1 package-name2 package-name3" (batch multiple packages together)
- ALWAYS include both the package and its @types version if applicable

EXAMPLES OF REQUIRED shellCommands:
- If you use: import { v4 as uuidv4 } from 'uuid'
  Then include: ["npm install uuid @types/uuid"]
  
- If you use: import axios from 'axios'
  Then include: ["npm install axios"]
  
- If you use: import { BrowserRouter } from 'react-router-dom'
  Then include: ["npm install react-router-dom @types/react-router-dom"]

- If you use multiple packages:
  Then include: ["npm install uuid axios date-fns @types/uuid"]

CRITICAL IMAGE USAGE RULES - UNSPLASH ONLY:
- MANDATORY: ALL images MUST use valid Unsplash images

- INVALID (DO NOT USE):
  ✗ placeholder.com, via.placeholder.com, placehold.it
  ✗ example.com/image.jpg
  ✗ /images/photo.jpg (local paths)
  ✗ Generic or fake URLs


INSTRUCTIONS:
1. Generate modern, clean React components using TypeScript
2. Use Tailwind CSS for all styling (no external CSS files unless necessary)
3. Follow React best practices and hooks patterns
4. Use functional components with proper TypeScript types
5. Ensure code is production-ready and well-structured
6. Only create/modify files that are necessary for the user's request
7. MANDATORY: Review all your imports and add required packages to shellCommands
8. MANDATORY: Use ONLY valid Unsplash image URLs

OUTPUT REQUIREMENTS:
- fileOperations: Array of operations (createFile, rewriteFile, updateFile, deleteFile)
- shellCommands: Array of npm install commands for ANY imported packages not in the base template
  * MUST be empty array [] ONLY if no new packages are imported
  * If ANY external package is used, it MUST be in shellCommands
- explanation: A brief, user-friendly explanation of what you created

VERIFICATION BEFORE RESPONDING:
1. List all import statements in your code
2. Check if each imported package is in the standard packages list
3. For each non-standard package, ensure it's in shellCommands
4. If you forgot a package, ADD IT NOW to shellCommands


IMPORTANT:
- File paths should be relative to project root (e.g., "src/components/Button.tsx")
- Include complete file content, not snippets
- Ensure all imports are correct
- Use proper TypeScript types
- NEVER skip packages in shellCommands - this causes build failures
- NEVER use placeholder image services - ONLY Unsplash URLs are acceptable`;
}

export default router;