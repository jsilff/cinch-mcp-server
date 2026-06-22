#!/usr/bin/env node

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * Cinch MCP Server
 *
 * Bridges to the Cinch tRPC API using an organization-wide AI Token (PAT).
 *
 * Environment:
 * - CINCH_API_URL — hosted Cinch URL (default: https://app.cinch.work)
 * - CINCH_PAT — AI Token from Cinch → Settings → Personal Access Tokens
 * - CINCH_COMPANY_ID — optional default organization scope
 */

const API_URL = process.env.CINCH_API_URL || 'https://app.cinch.work';
const PAT = process.env.CINCH_PAT;

if (!PAT) {
  console.error('Error: CINCH_PAT environment variable is required');
  process.exit(1);
}

const TRPC_URL = `${API_URL.replace(/\/$/, '')}/api/trpc`;

const taskStatusSchema = z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED']);

type CompanyMembership = {
  companyId: string;
  company: { name: string; slug: string };
};

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

function textResult(result: unknown, isError = false) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      },
    ],
    ...(isError ? { isError: true as const } : {}),
  };
}

async function runTool<T>(fn: () => Promise<T>) {
  try {
    return textResult(await fn());
  } catch (error) {
    return textResult(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
      true
    );
  }
}

async function listCompanyMemberships(): Promise<CompanyMembership[]> {
  return trpcCall<CompanyMembership[]>('company.listMemberships', undefined, 'query');
}

const server = new McpServer({
  name: 'cinch-mcp',
  version: '1.1.0',
});

// --- Project tools ---

server.registerTool(
  'create_project',
  {
    description: 'Create a new project in Cinch',
    inputSchema: {
      name: z.string().min(1).max(100),
      key: z.string().min(2).max(10).describe('Short project key (2–10 characters)'),
      description: z.string().optional(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe('Hex color, e.g. #6366f1'),
      groupId: z.string().optional(),
      companyId: z.string().optional(),
    },
  },
  async (input) =>
    runTool(() =>
      trpcCall('project.create', { ...input, key: input.key.toUpperCase() }, 'mutation')
    )
);

server.registerTool(
  'list_projects',
  {
    description: 'List projects (optionally filtered by company, group, archived status)',
    inputSchema: {
      includeArchived: z.boolean().optional().describe('Include archived projects'),
      groupId: z.string().optional(),
      companyId: z.string().optional(),
    },
  },
  async (input) => runTool(() => trpcCall('project.list', input, 'query'))
);

server.registerTool(
  'get_project',
  {
    description: 'Get detailed project information including members and custom fields',
    inputSchema: {
      id: z.string().describe('Project ID'),
    },
  },
  async ({ id }) => runTool(() => trpcCall('project.get', { id }, 'query'))
);

// --- Task tools ---

server.registerTool(
  'create_task',
  {
    description: 'Create a new task in a project',
    inputSchema: {
      projectId: z.string(),
      title: z.string().min(1).max(500),
      description: z.string().optional(),
      parentId: z.string().optional(),
      assigneeId: z.string().optional(),
      followerIds: z.array(z.string()).optional(),
      dueDate: z.string().datetime().optional(),
      startDate: z.string().datetime().optional(),
      priority: z.number().min(0).max(4).optional(),
      status: taskStatusSchema.optional(),
    },
  },
  async (input) => runTool(() => trpcCall('task.create', input, 'mutation'))
);

server.registerTool(
  'list_tasks',
  {
    description: 'List tasks with various filters (project, status, assignee, etc.)',
    inputSchema: {
      projectId: z.string().optional(),
      status: taskStatusSchema.optional(),
      assigneeId: z.string().optional(),
      parentId: z.string().nullable().optional(),
      includeSubtasks: z.boolean().optional(),
      companyId: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.number().min(1).max(100).optional(),
    },
  },
  async (input) => runTool(() => trpcCall('task.list', input, 'query'))
);

server.registerTool(
  'get_task',
  {
    description:
      'Get detailed task information including comments, attachments (URLs), tags, and subtasks',
    inputSchema: {
      id: z.string().describe('Task ID'),
    },
  },
  async ({ id }) => runTool(() => trpcCall('task.get', { id }, 'query'))
);

server.registerTool(
  'update_task',
  {
    description: 'Update an existing task',
    inputSchema: {
      id: z.string(),
      title: z.string().min(1).max(500).optional(),
      description: z.string().optional(),
      status: taskStatusSchema.optional(),
      priority: z.number().min(0).max(4).optional(),
      assigneeId: z.string().optional(),
      dueDate: z.string().datetime().nullable().optional(),
      startDate: z.string().datetime().nullable().optional(),
      completedAt: z.string().datetime().nullable().optional(),
    },
  },
  async (input) => runTool(() => trpcCall('task.update', input, 'mutation'))
);

// --- Comment tools ---

server.registerTool(
  'create_comment',
  {
    description: 'Add a comment to a task (supports @mentions)',
    inputSchema: {
      taskId: z.string(),
      content: z.string().min(1),
      parentId: z.string().optional(),
    },
  },
  async (input) => runTool(() => trpcCall('comment.create', input, 'mutation'))
);

server.registerTool(
  'list_comments',
  {
    description: 'List comments on a task',
    inputSchema: {
      taskId: z.string(),
      cursor: z.string().optional(),
      limit: z.number().min(1).max(50).optional(),
    },
  },
  async (input) => runTool(() => trpcCall('comment.list', input, 'query'))
);

// --- Company tools ---

server.registerTool(
  'list_companies',
  {
    description: 'List all companies the authenticated user is a member of',
  },
  async () => runTool(() => listCompanyMemberships())
);

server.registerTool(
  'get_company',
  {
    description: 'Get company details including members and groups',
    inputSchema: {
      companyId: z.string(),
    },
  },
  async ({ companyId }) => runTool(() => trpcCall('company.get', { companyId }, 'query'))
);

// --- Resources (organizations) ---

server.registerResource(
  'company',
  new ResourceTemplate('cinch://company/{companyId}', {
    list: async () => {
      const companies = await listCompanyMemberships();
      return {
        resources: companies.map((membership) => ({
          uri: `cinch://company/${membership.companyId}`,
          name: membership.company.name,
          description: `Company: ${membership.company.name} (${membership.company.slug})`,
          mimeType: 'application/json',
        })),
      };
    },
  }),
  {
    description: 'Cinch organization (company) details',
    mimeType: 'application/json',
  },
  async (uri, variables) => {
    const companyId = variables.companyId;
    if (!companyId) {
      throw new Error(`Missing companyId in resource URI: ${uri.href}`);
    }
    const company = await trpcCall('company.get', { companyId }, 'query');
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(company, null, 2),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Cinch MCP Server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
