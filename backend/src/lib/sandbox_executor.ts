import { Result, Sandbox } from "@e2b/code-interpreter";
import { FileOperation } from "../types";

export class SandboxExecutor {
    // Execute a single file operation in the sandbox
    async executeFileOperation(sandbox: Sandbox, operation: FileOperation): Promise<void> {
        console.log(`Executing ${operation.type}: ${operation.path}`);
        
        switch (operation.type) {
            case 'createFile':
            case 'rewriteFile': {
                // Ensure the directory exists
                const dir = operation.path.substring(0, operation.path.lastIndexOf('/'));
                if (dir && dir !== 'src' && dir !== '') {
                    await sandbox.commands.run(`mkdir -p ${dir}`);
                }

                // Write file content
                await sandbox.files.write(operation.path, operation.content);
                console.log(`${operation.type} executed on ${operation.path}`);
                break;
            }

            case 'updateFile': {
                let content = await sandbox.files.read(operation.path);
                for (const { search, replace } of operation.searchReplace) {
                    const regex = RegExp(search, 'g');
                    content = content.replace(regex, replace);
                }
                await sandbox.files.write(operation.path, content);
                console.log(`Updated file: ${operation.path}`);
                break;
            }

            case 'deleteFile': {
                await sandbox.commands.run(`rm ${operation.path}`);
                console.log(`Deleted file: ${operation.path}`);
                break;
            }
        }
    }

    // Execute a shell command safely with retry logic and optimization
    async executeShellCommands(
        sandbox: Sandbox,
        command: string,
        maxRetries: number = 3
    ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
        if (!this.isSafeCommand(command)) {
            throw new Error(`Unsafe command rejected: ${command}`);
        }

        // Dynamic timeout based on command type
        let timeoutMs = 180000; // 3 minutes default

        if (command.includes('npm install') || command.includes('npm i ')) {
            // Extract package count for dynamic scaling
            const packageCount = command
                .split(' ')
                .filter(p => 
                    !p.startsWith('-') && 
                    p !== 'npm' && 
                    p !== 'install' && 
                    p !== 'i' &&
                    p.trim() !== ''
                ).length;

            // Scale timeout: 5 minutes base + 1 minute per package
            timeoutMs = Math.max(300000, 300000 + (packageCount * 60000));
            console.log(`Installing ${packageCount} package(s) with ${timeoutMs / 1000}s timeout`);
        }

        // Optimize npm install commands with flags
        let optimizedCommand = command;
        if (command.includes('npm install') && !command.includes('--prefer-offline')) {
            optimizedCommand = command.replace(
                'npm install',
                'npm install --prefer-offline --legacy-peer-deps'
            );
            console.log(`Optimized command: ${optimizedCommand}`);
        }

        let lastError: Error | null = null;

        // Retry loop with multiple strategies
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Executing command (attempt ${attempt}/${maxRetries}): ${optimizedCommand}`);

                const result = await sandbox.commands.run(optimizedCommand, {
                    timeoutMs: timeoutMs,
                });

                if (result.exitCode !== 0) {
                    console.error(`Command failed with exit code ${result.exitCode}`);
                    console.error('stderr:', result.stderr);

                    // Try different strategies on npm failures
                    if (attempt < maxRetries && command.includes('npm install')) {
                        // Strategy 1: Remove --prefer-offline (force network fetch)
                        if (optimizedCommand.includes('--prefer-offline')) {
                            optimizedCommand = optimizedCommand
                                .replace('--prefer-offline', '')
                                .replace(/\s+/g, ' ');
                            console.log(`Retry without cache: ${optimizedCommand}`);
                            
                            // Wait before retry (exponential backoff)
                            await new Promise(resolve => setTimeout(resolve, attempt * 3000));
                            continue;
                        }

                        // Strategy 2: Try with --force flag
                        if (!optimizedCommand.includes('--force')) {
                            optimizedCommand = optimizedCommand + ' --force';
                            console.log(`Retry with --force: ${optimizedCommand}`);
                            
                            await new Promise(resolve => setTimeout(resolve, attempt * 3000));
                            continue;
                        }
                    }

                    // Non-npm commands or exhausted retries - return failure
                    return {
                        exitCode: result.exitCode,
                        stdout: result.stdout,
                        stderr: result.stderr,
                    };
                }

                console.log(`Command completed successfully: ${optimizedCommand}`);
                return {
                    exitCode: result.exitCode,
                    stdout: result.stdout,
                    stderr: result.stderr,
                };

            } catch (error) {
                lastError = error as Error;
                console.error(`Command execution error (attempt ${attempt}/${maxRetries}):`, error);

                if (attempt < maxRetries) {
                    // Exponential backoff: 3s, 6s, 9s
                    const waitTime = attempt * 3000;
                    console.log(`Waiting ${waitTime / 1000}s before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }

        throw lastError || new Error(`Command failed after ${maxRetries} attempts: ${command}`);
    }

    // Start a vite server and return a public URL
    async startDevServer(sandbox: Sandbox): Promise<string> {
        console.log('Starting vite dev server...');
        
        await sandbox.commands.run('npm run dev &', {
            background: true,
        });

        // Wait for the server to be ready
        await this.waitForServer(sandbox, 3000, 40);

        const previewUrl = sandbox.getHost(3000);
        console.log(`Dev server ready at: ${previewUrl}`);
        return previewUrl;
    }

    // Get file tree from sandbox
    async getFileTree(sandbox: Sandbox): Promise<Array<{ path: string; type: 'file' | 'directory' }>> {
        const result = await sandbox.commands.run(
            'find . -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.json" -o -name "*.css" -o -name "*.html" \\) -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" | head -100'
        );

        const paths = result.stdout
            .split('\n')
            .filter(p => p && p.trim() !== '')
            .map(p => p.replace('./', ''));

        return paths.map(path => ({
            path,
            type: 'file',
        }));
    }

    // Read the file content from the sandbox
    async readFile(sandbox: Sandbox, path: string): Promise<string> {
        return await sandbox.files.read(path);
    }

    // Check if a command is safe to execute
    private isSafeCommand(command: string): boolean {
        const allowedPatterns = [
            /^npm install(\s|$)/,
            /^npm i(\s|$)/,
            /^npm run dev(\s|$)/,
            /^npm run build(\s|$)/,
            /^npx\s/,
            /^yarn add(\s|$)/,
            /^pnpm install(\s|$)/,
            /^pnpm add(\s|$)/,
        ];

        const dangerousPatterns = [
            /rm\s+-rf\s+\//,
            /sudo/,
            /curl.*\|.*sh/,
            /wget.*\|.*sh/,
            />.*\/dev\//,
            /mkfs/,
            /dd\s+if=/,
        ];

        const isAllowed = allowedPatterns.some(re => re.test(command));
        const isDangerous = dangerousPatterns.some(re => re.test(command));

        return isAllowed && !isDangerous;
    }

    // Wait for server to be ready on specified port
    private async waitForServer(
        sandbox: Sandbox,
        port: number,
        maxAttempts: number = 30
    ): Promise<void> {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const result = await sandbox.commands.run(
                    `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}`,
                    { timeoutMs: 5000 }
                );

                const statusCode = result.stdout.trim();
                if (statusCode === '200' || result.exitCode === 0) {
                    console.log(`Server responded after ${attempt} attempts`);
                    return;
                }
            } catch (error) {
                // Server not ready yet, continue waiting
            }

            // Wait before next attempt
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            if (attempt % 10 === 0) {
                console.log(`Still waiting for server... (${attempt}/${maxAttempts})`);
            }
        }

        throw new Error(`Dev server failed to start after ${maxAttempts} attempts`);
    }
}
