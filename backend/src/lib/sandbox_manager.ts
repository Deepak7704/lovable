import { Sandbox } from '@e2b/code-interpreter';
import 'dotenv/config';

export class SandboxManager {
  private sandboxes = new Map<string, Sandbox>();
  private readonly TIMEOUT = 30 * 60 * 1000; // 30 minutes

  async create(projectId: string): Promise<Sandbox> {
    console.log(`Creating sandbox for project: ${projectId}`);

    if (!process.env.E2B_API_KEY) {
      throw new Error('E2B_API_KEY is not set in environment variables');
    }

    const sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: this.TIMEOUT,
    });

    console.log(`Sandbox created with ID: ${sandbox.sandboxId}`);

    // Load Bolt-style boilerplate
    await this.loadBoltBoilerplate(sandbox);

    this.sandboxes.set(projectId, sandbox);

    setTimeout(() => {
      this.cleanup(projectId);
    }, this.TIMEOUT);

    return sandbox;
  }

  get(projectId: string): Sandbox | undefined {
    return this.sandboxes.get(projectId);
  }

  /**
   * Load Bolt.new-style React + Vite + TypeScript + Tailwind boilerplate
   */
  private async loadBoltBoilerplate(sandbox: Sandbox): Promise<void> {
    console.log('Loading Bolt-style boilerplate...');

    // Bolt.new-inspired boilerplate structure
    const files: Record<string, string> = {
      // package.json - Minimal and clean like Bolt
      'package.json': JSON.stringify(
        {
          name: 'vite-react-app',
          private: true,
          version: '0.0.0',
          type: 'module',
          scripts: {
            dev: 'vite --host 0.0.0.0 --port 3000',
            build: 'vite build',
            preview: 'vite preview',
          },
          dependencies: {
            react: '^18.3.1',
            'react-dom': '^18.3.1',
          },
          devDependencies: {
            '@types/react': '^18.3.12',
            '@types/react-dom': '^18.3.1',
            '@vitejs/plugin-react': '^4.3.3',
            autoprefixer: '^10.4.20',
            postcss: '^8.4.49',
            tailwindcss: '^3.4.15',
            typescript: '^5.6.3',
            'typescript-eslint': '^8.11.0',
            vite: '^5.4.11',
          },
        },
        null,
        2
      ),

      // vite.config.ts
      'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
});
`,

      // tsconfig.json
      'tsconfig.json': JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            useDefineForClassFields: true,
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            skipLibCheck: true,
            moduleResolution: 'bundler',
            allowImportingTsExtensions: true,
            isolatedModules: true,
            moduleDetection: 'force',
            noEmit: true,
            jsx: 'react-jsx',
            strict: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            noFallthroughCasesInSwitch: true,
            noUncheckedSideEffectImports: true,
          },
          include: ['src'],
        },
        null,
        2
      ),

      // tailwind.config.js
      'tailwind.config.js': `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
`,

      // postcss.config.js
      'postcss.config.js': `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,

      // index.html - Clean Bolt-style HTML
      'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,

      // src/main.tsx
      'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`,

      // src/App.tsx - Clean component like Bolt generates
      'src/App.tsx': `export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">
          Welcome to Your App
        </h1>
        <p className="text-gray-600">
          Start building by describing what you want to create
        </p>
      </div>
    </div>
  );
}
`,

      // src/index.css - Tailwind directives
      'src/index.css': `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
    };

    // Write files to sandbox
    for (const [path, content] of Object.entries(files)) {
      const dir = path.substring(0, path.lastIndexOf('/'));
      if (dir) {
        await sandbox.commands.run(`mkdir -p ${dir}`);
      }
      await sandbox.files.write(path, content);
    }

    console.log('Boilerplate files created ✓');

    // Install dependencies
    console.log('Installing dependencies...');
    const result = await sandbox.commands.run('npm install', {
      timeoutMs: 180000,
    });

    if (result.exitCode !== 0) {
      throw new Error(`npm install failed: ${result.stderr}`);
    }

    console.log('Dependencies installed ✓');
  }

  async cleanup(projectId: string): Promise<void> {
    const sandbox = this.sandboxes.get(projectId);
    if (sandbox) {
      try {
        await sandbox.kill();
        this.sandboxes.delete(projectId);
        console.log(`Sandbox cleaned up: ${projectId}`);
      } catch (error) {
        console.error(`Cleanup error for ${projectId}:`, error);
      }
    }
  }

  getActiveSandboxes(): string[] {
    return Array.from(this.sandboxes.keys());
  }
}
