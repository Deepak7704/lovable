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
        searchReplace: z.array(z.object({
            search : z.string().describe('Text to search for'),
            replace : z.string().describe('Text to replace with'),
        })).describe('Array of search/replace operations'),
    }),
    z.object({
        type : z.literal('deleteFile'),
        path : z.string().describe('File path to delte'),
    }),
]);

// this app context schema allows the ai to self-identify what type of application it's building
export const AppContextSchema = z.object({
    appType : z.string().describe('Type of application being built (e.g., ecommerce, blog, dashboard, portfolio, social-media, booking-system)'),
    primaryEntities : z.array(z.string()).describe('Main entities/resources in the app (e.g., products, posts, users, bookings)'),
    imageKeywords: z.array(z.string()).describe('Unsplash search keywords relevant to the app content (e.g., ["technology", "gadgets"] for tech store)')
})

export const GenerationSchema = z.object({
    appContext: AppContextSchema.optional().describe('Context about the application being built for dynamic image and styling decisions'),
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