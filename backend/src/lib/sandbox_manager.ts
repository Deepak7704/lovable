import { Sandbox } from '@e2b/code-interpreter';
import 'dotenv/config';

// Get template ID from environment variables
const TEMPLATE_ID = process.env.E2B_TEMPLATE_ID;

export class SandboxManager {
  private sandboxes = new Map<string, Sandbox>();
  private readonly TIMEOUT = 30 * 60 * 1000; // 30 minutes

  async create(projectId: string): Promise<Sandbox> {
    console.log(`Creating sandbox for project: ${projectId}`);

    // Validate required environment variables
    if (!process.env.E2B_API_KEY) {
      throw new Error('E2B_API_KEY is not set in environment variables');
    }

    if (!TEMPLATE_ID) {
      throw new Error('E2B_TEMPLATE_ID is not set in environment variables');
    }

    console.log(`Using template: ${TEMPLATE_ID}`);

    // Create sandbox from pre-built template (fast!)
    const sandbox = await Sandbox.create(TEMPLATE_ID, {
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: this.TIMEOUT,
    });

    console.log(`Sandbox created with ID: ${sandbox.sandboxId}`);
    console.log('✓ Template loaded (dependencies pre-installed)');

    // Store sandbox reference
    this.sandboxes.set(projectId, sandbox);

    // Schedule automatic cleanup after timeout
    setTimeout(() => {
      this.cleanup(projectId);
    }, this.TIMEOUT);

    return sandbox;
  }

  /**
   * Get existing sandbox by project ID
   */
  get(projectId: string): Sandbox | undefined {
    return this.sandboxes.get(projectId);
  }

  /**
   * Clean up and kill a sandbox
   */
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

  /**
   * Get list of all active sandbox project IDs
   */
  getActiveSandboxes(): string[] {
    return Array.from(this.sandboxes.keys());
  }
}