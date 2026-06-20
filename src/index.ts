#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/**
 * Cinch MCP Server
 * 
 * A Model Context Protocol server that bridges to the Cinch tRPC API.
 * Uses an organization-wide AI Token (PAT) for authentication.
 * 
 * Configuration via environment variables:
 * - CINCH_API_URL: Hosted Cinch app URL (default: https://app.cinch.work)
 * - CINCH_PAT: AI Token from Cinch → Settings → Personal Access Tokens
 * - CINCH_COMPANY_ID: Optional company ID to scope operations to
 */

// Configuration from environment
const API_URL = process.env.CINCH_API_URL || 'https://app.cinch.work';
const PAT = process.env.CINCH_PAT;
const DEFAULT_COMPANY_ID = process.env.CINCH_COMPANY_ID;

if (!PAT) {
  console.error('Error: CINCH_PAT environment variable is required');
  process.exit(1);
}

// tRPC endpoint
const TRPC_URL = `${API_URL.replace(/\/$/, '')}/api/trpc`;

// HTTP client for tRPC calls (Cinch uses superjson; queries are GET, mutations are POST)
async function trpcCall<T>(
  procedure: string,
  input: unknown | undefined,
  kind: 'query' | 'mutation'
): Promise<T> {
  const baseUrl = `${TRPC_URL}/${procedure}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${PAT}`,
  };

  const response =
    kind === 'mutation'
      ? await fetch(baseUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(input === undefined ? undefined : { json: input }),
        })
      : await fetch(
          input === undefined
            ? baseUrl
            : `${baseUrl}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
          { method: 'GET', headers }
        );

  const payload = (await response.json()) as {
    error?: { json?: { message?: string }; message?: string };
    result?: { data?: { json?: T } };
  };

  if (!response.ok) {
    const message =
      payload.error?.json?.message ??
      payload.error?.message ??
      `HTTP ${response.status}`;
    throw new Error(`tRPC error (${response.status}): ${message}`);
  }

  if (payload.error) {
    const message = payload.error.json?.message ?? payload.error.message ?? 'Unknown error';
    throw new Error(`tRPC error: ${message}`);
  }

  return payload.result?.data?.json as T;
}

// Define tool schemas using Zod
const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  key: z.string().min(2).max(10).toUpperCase(),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#6366f1'),
  groupId: z.string().optional(),
  companyId: z.string().optional(),
});

const CreateTaskSchema = z.object({
  projectId: z.string(),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  parentId: z.string().optional(),
  assigneeId: z.string().optional(),
  followerIds: z.array(z.string()).optional(),
  dueDate: z.string().datetime().optional(),
  startDate: z.string().datetime().optional(),
  priority: z.number().min(0).max(4).default(0),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED']).default('TODO'),
});

const UpdateTaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED']).optional(),
  priority: z.number().min(0).max(4).optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
});

const ListProjectsSchema = z.object({
  includeArchived: z.boolean().default(false),
  groupId: z.string().optional(),
  companyId: z.string().optional(),
});

const ListTasksSchema = z.object({
  projectId: z.string().optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED']).optional(),
  assigneeId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  includeSubtasks: z.boolean().default(false),
  companyId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
});

const GetProjectSchema = z.object({
  id: z.string(),
});

const GetTaskSchema = z.object({
  id: z.string(),
});

const CreateCommentSchema = z.object({
  taskId: z.string(),
  content: z.string().min(1),
  parentId: z.string().optional(),
});

const ListCommentsSchema = z.object({
  taskId: z.string(),
  cursor: z.string().optional(),
  limit: z.number().min(1).max(50).default(20),
});

const ListCompaniesSchema = z.object({});

const GetCompanySchema = z.object({
  companyId: z.string(),
});

// MCP Server instance
const server = new Server(
  {
    name: 'cinch-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // Project tools
    {
      name: 'create_project',
      description: 'Create a new project in Cinch',
      inputSchema: CreateProjectSchema,
    },
    {
      name: 'list_projects',
      description: 'List projects (optionally filtered by company, group, archived status)',
      inputSchema: ListProjectsSchema,
    },
    {
      name: 'get_project',
      description: 'Get detailed project information including members and custom fields',
      inputSchema: GetProjectSchema,
    },
    // Task tools
    {
      name: 'create_task',
      description: 'Create a new task in a project',
      inputSchema: CreateTaskSchema,
    },
    {
      name: 'list_tasks',
      description: 'List tasks with various filters (project, status, assignee, etc.)',
      inputSchema: ListTasksSchema,
    },
    {
      name: 'get_task',
      description: 'Get detailed task information',
      inputSchema: GetTaskSchema,
    },
    {
      name: 'update_task',
      description: 'Update an existing task',
      inputSchema: UpdateTaskSchema,
    },
    // Comment tools
    {
      name: 'create_comment',
      description: 'Add a comment to a task (supports @mentions)',
      inputSchema: CreateCommentSchema,
    },
    {
      name: 'list_comments',
      description: 'List comments on a task',
      inputSchema: ListCommentsSchema,
    },
    // Company tools
    {
      name: 'list_companies',
      description: 'List all companies the authenticated user is a member of',
      inputSchema: ListCompaniesSchema,
    },
    {
      name: 'get_company',
      description: 'Get company details including members and groups',
      inputSchema: GetCompanySchema,
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      // Project tools
      case 'create_project': {
        const input = CreateProjectSchema.parse(args);
        result = await trpcCall('project.create', input, 'mutation');
        break;
      }
      case 'list_projects': {
        const input = ListProjectsSchema.parse(args);
        result = await trpcCall('project.list', input, 'query');
        break;
      }
      case 'get_project': {
        const input = GetProjectSchema.parse(args);
        result = await trpcCall('project.get', input, 'query');
        break;
      }
      // Task tools
      case 'create_task': {
        const input = CreateTaskSchema.parse(args);
        result = await trpcCall('task.create', input, 'mutation');
        break;
      }
      case 'list_tasks': {
        const input = ListTasksSchema.parse(args);
        result = await trpcCall('task.list', input, 'query');
        break;
      }
      case 'get_task': {
        const input = GetTaskSchema.parse(args);
        result = await trpcCall('task.get', input, 'query');
        break;
      }
      case 'update_task': {
        const input = UpdateTaskSchema.parse(args);
        result = await trpcCall('task.update', input, 'mutation');
        break;
      }
      // Comment tools
      case 'create_comment': {
        const input = CreateCommentSchema.parse(args);
        result = await trpcCall('comment.create', input, 'mutation');
        break;
      }
      case 'list_comments': {
        const input = ListCommentsSchema.parse(args);
        result = await trpcCall('comment.list', input, 'query');
        break;
      }
      // Company tools
      case 'list_companies': {
        result = await trpcCall('company.listMemberships', undefined, 'query');
        break;
      }
      case 'get_company': {
        const input = GetCompanySchema.parse(args);
        result = await trpcCall('company.get', input, 'query');
        break;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const companies = await trpcCall<Array<{ companyId: string; company: { name: string; slug: string } }>>(
    'company.listMemberships',
    undefined,
    'query'
  );
  
  return {
    resources: companies.map(m => ({
      uri: `cinch://company/${m.companyId}`,
      name: m.company.name,
      description: `Company: ${m.company.name} (${m.company.slug})`,
      mimeType: 'application/json',
    })),
  };
});

// Read a resource
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  
  // Handle cinch://company/{id} URIs
  const match = uri.match(/^cinch:\/\/company\/(.+)$/);
  if (match) {
    const companyId = match[1];
    const company = await trpcCall('company.get', { companyId }, 'query');
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(company, null, 2),
        },
      ],
    };
  }
  
  throw new Error(`Unknown resource URI: ${uri}`);
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Cinch MCP Server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
