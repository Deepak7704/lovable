import { Result, Sandbox } from "@e2b/code-interpreter";
import { FileOperation } from "../types";
import { exitCode } from "process";
import { tr } from "zod/locales";

export class SandboxExecutor{
    //excutes a single file operation in the sandbox
    async executeFileOperation(sandbox : Sandbox,operation : FileOperation):Promise<void>{
        console.log(`Executing ${operation.type}:${operation.path}`);
        switch(operation.type){
            case 'createFile':
            case 'rewriteFile':{
                // to ensure the directory exits
                const dir = operation.path.substring(0,operation.path.lastIndexOf('/'));
                if(dir && dir !== 'src' && dir !== ''){
                    await sandbox.commands.run(`mkdir -p ${dir}`);
                }

                // write file content 
                await sandbox.files.write(operation.path,operation.content);
                console.log(`${operation.type} is executed on this ${operation.path}`);

                break;
            }
            case 'updateFile':{
                let content = await sandbox.files.read(operation.path);
                for (const {search,replace} of operation.serachReplace){
                    const regex = RegExp(search,'g');
                    content = content.replace(regex,replace);
                }
                await sandbox.files.write(operation.path,content);
                console.log(`updated file : ${operation.path}`);
                break;
            }
            case 'deleteFile':{
                await sandbox.commands.run(`rm ${operation.path}`);
                console.log(`Deleted file:${operation.path}`);
                break;
            }
        }
    }

    // execute a shell command safely 
    async executeShellCommands(sandbox:Sandbox,command:string):Promise<{exitCode:number;stdout:string,stderr:string}>{
        if(!this.isSafeCommand(command)){
            throw new Error(`Unsafe command rejected ${command}`);
        }
        console.log(`Executing command ${command}`);
        const result = await sandbox.commands.run(command,{
            timeoutMs:180000,
        });
        if(result.exitCode !== 0){
            console.error(`Command Failed to execute ${result.exitCode}`);
            console.error('stderr',result.stderr);
        }else{
            console.log(`command completed:${command}`)
        }
        return {
            exitCode : result.exitCode,
            stdout:result.stdout,
            stderr : result.stderr
        }
    }
    //start a vite server and return a public url that helpst to load the preview url

    async startDevServer(sandbox:Sandbox):Promise<string>{
        console.log('Starting vite dev server...');

        await sandbox.commands.run('npm run dev &',{
            background:true
        });
        //waiting for the server to be ready
        await this.waitForServer(sandbox,3000,40);
        const previewUrl = sandbox.getHost(3000);
        console.log(`Dev server ready at :${previewUrl}`);

        return previewUrl;
    }

    async getFileTree(sandbox:Sandbox): Promise<Array<{path:string,type:'file'|'directory'}>>{
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

    //Read the file content from the sandbox
    async readFile(sandbox:Sandbox,path:string):Promise<string>{
        return await sandbox.files.read(path);
    }

    private isSafeCommand(command:string):boolean{
        const allowedPatterns = [
                /^npm install(\s|$)/,
                /^npm run dev(\s|$)/,
                /^npm run build(\s|$)/,
                /^npx\s/,
                /^yarn add(\s|$)/,
                /^pnpm install(\s|$)/,];
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
    //wait for server to be ready on specified port
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
            // Server not ready yet
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