// File operation schemas for zod validation
import { z } from "zod";

export const FileOperationSchema = z.discriminatedUnion('type',[
    z.object({
        type : z.literal('createFile'),
        path : z.string().describe('File path relative to project root'),
        content:z.string().describe('Complete file content'),
    }),
    z.object({
        type : z.literal('rewriteFile'),
        path : z.string().describe('File path to rewrite'),
        content : z.string().describe('New complete file content')
    }),
    z.object({
        type : z.literal('updateFile'),
        path : z.string().describe('File path to update'),
        serachReplace: z.array(z.object({
            search : z.string().describe('Text to search for'),
            replace : z.string().describe('Text to replace with'),
        })).describe('Array of search/replace operations'),
    }),
    z.object({
        type : z.literal('deleteFile'),
        path : z.string().describe('File path to delte'),
    }),
]);

export const GenerationSchema = z.object({
    fileOperations : z.array(FileOperationSchema).describe('Array of file operations to execute in order'),
    shellCommands : z.array(z.string()).describe('Shell commands to run (e.g., npm install package-name)'),
    explanation : z.string().describe('Brief explanation of what was created or modified'),
});


export type FileOperation = z.infer<typeof FileOperationSchema>
export type GenerateOutput = z.infer<typeof GenerationSchema>

// custom data messsages for the status of the code 
export interface OperatioStatusData{
    operation : FileOperation;
    status : 'pending' | 'running' | 'completed' | 'error';
    error ?: string;
    index : number;
    total : number;
}

export interface CommandStatusData {
    command : string,
    status : 'running' | 'completed' | 'error'
}

export interface ServerStatusData{
    status : 'starting' | 'ready' | 'error';
    previewUrl?: string;
    error ?: string;
}

export interface FileTreeData {
    files: Array<{
        path : string;
        type : 'file' | 'directory'
    }>;
}

export interface NotificationData{
    message : string;
    level : 'info' | 'warning' | 'error' | 'success'
}

export interface StageStatusData{
    stage: 'sandbox' | 'ai' | 'execution' | 'server';
    status : 'starting' | 'running' | 'completed' | 'error';
    message?: string;
}