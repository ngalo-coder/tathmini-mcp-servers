// Updated odk-mcp-server.js for better n8n compatibility

const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Environment variables
const ODK_BASE_URL = process.env.ODK_BASE_URL;
const ODK_USERNAME = process.env.ODK_USERNAME;
const ODK_PASSWORD = process.env.ODK_PASSWORD;
const PORT = process.env.PORT || 3001;

console.log('=== ODK MCP Server Starting ===');
console.log('ODK_BASE_URL:', ODK_BASE_URL);
console.log('ODK_USERNAME:', ODK_USERNAME ? 'SET' : 'NOT SET');
console.log('ODK_PASSWORD:', ODK_PASSWORD ? 'SET' : 'NOT SET');
console.log('PORT:', PORT);

// ODK API helper
class ODKConnector {
  constructor() {
    this.baseURL = ODK_BASE_URL;
    this.auth = {
      username: ODK_USERNAME,
      password: ODK_PASSWORD
    };
    console.log('ODKConnector initialized with baseURL:', this.baseURL);
  }

  async getSubmissions(projectId, formId, lastSync = null) {
    try {
      let url = `${this.baseURL}/v1/projects/${projectId}/forms/${formId}/submissions`;
      
      if (lastSync) {
        url += `?$filter=__system/submissionDate gt ${lastSync}`;
      }
      
      console.log('Getting submissions from:', url);
      
      const response = await axios.get(url, {
        auth: this.auth,
        timeout: 15000,
        headers: {
          'Accept': 'application/json'
        }
      });
      
      console.log('Submissions response status:', response.status);
      console.log('Submissions count:', response.data.length || 'Unknown');
      
      return response.data;
    } catch (error) {
      console.error('Failed to fetch submissions:', error.message);
      if (error.code === 'ENOTFOUND') {
        throw new Error(`Cannot reach ODK server at ${this.baseURL}. Please check the URL.`);
      }
      throw new Error(`Failed to fetch submissions: ${error.message}`);
    }
  }
}

const odkConnector = new ODKConnector();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ODK MCP Server',
    timestamp: new Date().toISOString(),
    environment: {
      ODK_BASE_URL: ODK_BASE_URL || 'NOT SET',
      ODK_USERNAME: ODK_USERNAME ? 'SET' : 'NOT SET',
      ODK_PASSWORD: ODK_PASSWORD ? 'SET' : 'NOT SET',
      PORT: PORT
    }
  });
});

// MCP Server Sent Events endpoint with enhanced compatibility
app.get('/odk-mcp/sse', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });

  // Send MCP protocol initialization
  const mcpInit = {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {
          listChanged: true
        }
      },
      serverInfo: {
        name: 'ODK MCP Server',
        version: '1.0.0'
      }
    }
  };

  res.write(`data: ${JSON.stringify(mcpInit)}\n\n`);

  // Send available tools list
  const toolsList = {
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {},
    result: {
      tools: [
        {
          name: 'fetch_submissions',
          description: 'Fetch submissions from ODK Central',
          inputSchema: {
            type: 'object',
            properties: {
              projectId: {
                type: 'string',
                description: 'ODK Project ID'
              },
              formId: {
                type: 'string', 
                description: 'ODK Form ID'
              },
              lastSync: {
                type: 'string',
                description: 'Last sync timestamp (optional)'
              }
            },
            required: ['projectId', 'formId']
          }
        }
      ]
    }
  };

  res.write(`data: ${JSON.stringify(toolsList)}\n\n`);

  // Keep connection alive
  const keepAlive = setInterval(() => {
    const heartbeat = {
      type: 'heartbeat',
      timestamp: new Date().toISOString()
    };
    res.write(`data: ${JSON.stringify(heartbeat)}\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    console.log('SSE connection closed');
  });

  // Send initial connection message
  const connected = {
    type: 'connected',
    message: 'ODK MCP Server connected',
    timestamp: new Date().toISOString()
  };
  res.write(`data: ${JSON.stringify(connected)}\n\n`);
});

// MCP tools endpoint with JSON-RPC 2.0 format
app.post('/odk-mcp/tools/call', async (req, res) => {
  try {
    const { jsonrpc, method, params, id } = req.body;
    
    console.log('=== MCP Tool Call ===');
    console.log('Method:', method);
    console.log('Params:', JSON.stringify(params, null, 2));

    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      
      if (name === 'fetch_submissions') {
        const { projectId, formId, lastSync } = args;
        
        if (!projectId || !formId) {
          return res.json({
            jsonrpc: '2.0',
            error: {
              code: -32602,
              message: 'Invalid params: projectId and formId are required'
            },
            id
          });
        }

        if (!ODK_BASE_URL || !ODK_USERNAME || !ODK_PASSWORD) {
          return res.json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'ODK credentials not configured'
            },
            id
          });
        }

        try {
          const submissions = await odkConnector.getSubmissions(projectId, formId, lastSync);
          
          return res.json({
            jsonrpc: '2.0',
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    data: submissions,
                    timestamp: new Date().toISOString(),
                    count: Array.isArray(submissions) ? submissions.length : 0,
                    projectId,
                    formId
                  }, null, 2)
                }
              ]
            },
            id
          });
        } catch (error) {
          return res.json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: error.message
            },
            id
          });
        }
      }
    }

    // Handle tools/list method
    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0',
        result: {
          tools: [
            {
              name: 'fetch_submissions',
              description: 'Fetch submissions from ODK Central',
              inputSchema: {
                type: 'object',
                properties: {
                  projectId: {
                    type: 'string',
                    description: 'ODK Project ID'
                  },
                  formId: {
                    type: 'string',
                    description: 'ODK Form ID'
                  },
                  lastSync: {
                    type: 'string',
                    description: 'Last sync timestamp (optional)'
                  }
                },
                required: ['projectId', 'formId']
              }
            }
          ]
        },
        id
      });
    }

    return res.json({
      jsonrpc: '2.0',
      error: {
        code: -32601,
        message: 'Method not found'
      },
      id
    });

  } catch (error) {
    console.error('MCP tool call error:', error.message);
    res.json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: error.message
      },
      id: req.body.id
    });
  }
});

// Legacy endpoints for backwards compatibility
app.post('/odk-mcp/tools/fetch_submissions', async (req, res) => {
  try {
    const { projectId, formId, lastSync } = req.body;
    
    console.log('=== Legacy Fetch Submissions Request ===');
    console.log('Project ID:', projectId);
    console.log('Form ID:', formId);
    console.log('Last Sync:', lastSync);
    
    if (!projectId || !formId) {
      return res.status(400).json({ error: 'projectId and formId are required' });
    }

    if (!ODK_BASE_URL || !ODK_USERNAME || !ODK_PASSWORD) {
      return res.status(500).json({ 
        error: 'ODK credentials not configured',
        missing: {
          ODK_BASE_URL: !ODK_BASE_URL,
          ODK_USERNAME: !ODK_USERNAME,
          ODK_PASSWORD: !ODK_PASSWORD
        }
      });
    }

    const submissions = await odkConnector.getSubmissions(projectId, formId, lastSync);
    
    res.json({
      success: true,
      data: submissions,
      timestamp: new Date().toISOString(),
      count: Array.isArray(submissions) ? submissions.length : 0
    });
  } catch (error) {
    console.error('Fetch submissions error:', error.message);
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Default route for MCP server
app.get('/', (req, res) => {
  res.json({
    name: 'ODK MCP Server',
    version: '1.0.0',
    description: 'MCP server for ODK Central integration with TathminiAI',
    endpoints: {
      health: '/health',
      sse: '/odk-mcp/sse',
      mcp_tools: '/odk-mcp/tools/call',
      legacy_fetch: '/odk-mcp/tools/fetch_submissions'
    },
    status: 'running'
  });
});

app.listen(PORT, () => {
  console.log(`ODK MCP Server running on port ${PORT}`);
  console.log('Environment check:');
  console.log('- ODK_BASE_URL:', ODK_BASE_URL || 'NOT SET');
  console.log('- ODK_USERNAME:', ODK_USERNAME ? 'SET' : 'NOT SET');
  console.log('- ODK_PASSWORD:', ODK_PASSWORD ? 'SET' : 'NOT SET');
  console.log('Available endpoints:');
  console.log('- Health: /health');
  console.log('- SSE: /odk-mcp/sse');
  console.log('- MCP Tools: /odk-mcp/tools/call');
  console.log('- Legacy: /odk-mcp/tools/fetch_submissions');
});